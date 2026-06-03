import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";

interface FlickeringGridProps extends React.HTMLAttributes<HTMLDivElement> {
  squareSize?: number;
  gridGap?: number;
  flickerChance?: number;
  color?: string;
  width?: number;
  height?: number;
  className?: string;
  maxOpacity?: number;
  text?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontFamily?: string;
  textMaxOpacity?: number;
  staticText?: boolean;
}

export const FlickeringGrid: React.FC<FlickeringGridProps> = ({
  squareSize = 4,
  gridGap = 6,
  flickerChance = 0.3,
  color = "rgb(0, 0, 0)",
  width,
  height,
  className,
  maxOpacity = 0.08,
  text,
  fontSize = 80,
  fontWeight = "bold",
  fontFamily = "sans-serif",
  textMaxOpacity = 0.4,
  staticText = false,
  ...props
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Hot props read inside the rAF loop. Keeping them in refs means
  // updating flickerChance / maxOpacity / color on every audio level
  // tick does NOT re-run the setup effect (which would otherwise cancel
  // the animation, resize the canvas, and re-randomize `squares` from
  // Math.random() — that's what was making the grid visibly vanish
  // while the user was speaking).
  const flickerChanceRef = useRef(flickerChance);
  const maxOpacityRef = useRef(maxOpacity);
  const textMaxOpacityRef = useRef(textMaxOpacity);
  flickerChanceRef.current = flickerChance;
  maxOpacityRef.current = maxOpacity;
  textMaxOpacityRef.current = textMaxOpacity;

  const buildTextMask = useCallback(
    (
      canvasWidth: number,
      canvasHeight: number,
      dpr: number,
    ): Uint8ClampedArray | null => {
      if (!text) return null;
      if (canvasWidth <= 0 || canvasHeight <= 0) return null;
      const offscreen = document.createElement("canvas");
      offscreen.width = canvasWidth;
      offscreen.height = canvasHeight;
      const ctx = offscreen.getContext("2d");
      if (!ctx) return null;
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      ctx.fillStyle = "#000";
      ctx.font = `${fontWeight} ${fontSize * dpr}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);
      return ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
    },
    [text, fontSize, fontWeight, fontFamily],
  );

  const memoizedColor = useMemo(() => {
    const toRGBA = (color: string) => {
      if (typeof window === "undefined") {
        return `rgba(0, 0, 0,`;
      }
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "rgba(255, 0, 0,";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      return `rgba(${r}, ${g}, ${b},`;
    };
    return toRGBA(color);
  }, [color]);
  // Same trick for color: callers flip between "primary" and a neutral
  // tone based on speaking state — we don't want that to cancel the
  // animation loop.
  const memoizedColorRef = useRef(memoizedColor);
  memoizedColorRef.current = memoizedColor;

  const setupCanvas = useCallback(
    (canvas: HTMLCanvasElement, width: number, height: number) => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const cols = Math.ceil(width / (squareSize + gridGap));
      const rows = Math.ceil(height / (squareSize + gridGap));

      const textMask = buildTextMask(canvas.width, canvas.height, dpr);

      const textSquares = new Uint8Array(cols * rows);
      if (textMask) {
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const px = Math.round(
              (i * (squareSize + gridGap) + squareSize / 2) * dpr,
            );
            const py = Math.round(
              (j * (squareSize + gridGap) + squareSize / 2) * dpr,
            );
            const idx = (py * canvas.width + px) * 4;
            textSquares[i * rows + j] = textMask[idx + 3] > 10 ? 1 : 0;
          }
        }
      }

      const initMaxOp = maxOpacityRef.current;
      const initTextMaxOp = textMaxOpacityRef.current;
      const squares = new Float32Array(cols * rows);
      for (let i = 0; i < squares.length; i++) {
        const inText = textSquares[i] === 1;
        squares[i] =
          inText && staticText
            ? initTextMaxOp * 0.85 + Math.random() * (initTextMaxOp * 0.15)
            : Math.random() * (inText ? initTextMaxOp : initMaxOp);
      }

      return { cols, rows, squares, dpr, textSquares };
    },
    [squareSize, gridGap, buildTextMask, staticText],
  );

  const updateSquares = useCallback(
    (squares: Float32Array, deltaTime: number, textSquares?: Uint8Array) => {
      const flicker = flickerChanceRef.current;
      const maxOp = maxOpacityRef.current;
      const textMaxOp = textMaxOpacityRef.current;
      for (let i = 0; i < squares.length; i++) {
        if (Math.random() < flicker * deltaTime) {
          const inText = textSquares ? textSquares[i] === 1 : false;
          if (inText) {
            const floor = textMaxOp * 0.8;
            squares[i] = floor + Math.random() * (textMaxOp - floor);
          } else {
            squares[i] = Math.random() * maxOp;
          }
        }
      }
    },
    [],
  );

  const drawGrid = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      cols: number,
      rows: number,
      squares: Float32Array,
      dpr: number,
      _textSquares?: Uint8Array,
    ) => {
      const color = memoizedColorRef.current;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "transparent";
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const idx = i * rows + j;
          const opacity = squares[idx];
          ctx.fillStyle = `${color}${opacity})`;
          ctx.fillRect(
            i * (squareSize + gridGap) * dpr,
            j * (squareSize + gridGap) * dpr,
            squareSize * dpr,
            squareSize * dpr,
          );
        }
      }
    },
    [squareSize, gridGap],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    let animationFrameId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let gridParams: ReturnType<typeof setupCanvas> | null = null;

    if (canvas && container && ctx) {
      const updateCanvasSize = () => {
        const newWidth = width || container.clientWidth;
        const newHeight = height || container.clientHeight;
        if (newWidth <= 0 || newHeight <= 0) return;
        setCanvasSize({ width: newWidth, height: newHeight });
        gridParams = setupCanvas(canvas, newWidth, newHeight);
      };

      updateCanvasSize();

      let lastTime = 0;
      const animate = (time: number) => {
        if (!isInView || !gridParams) return;

        const deltaTime = (time - lastTime) / 1000;
        lastTime = time;

        updateSquares(gridParams.squares, deltaTime, gridParams.textSquares);
        drawGrid(
          ctx,
          canvas.width,
          canvas.height,
          gridParams.cols,
          gridParams.rows,
          gridParams.squares,
          gridParams.dpr,
          gridParams.textSquares,
        );
        animationFrameId = requestAnimationFrame(animate);
      };

      resizeObserver = new ResizeObserver(() => {
        updateCanvasSize();
      });
      resizeObserver.observe(container);

      intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          setIsInView(entry.isIntersecting);
        },
        { threshold: 0 },
      );
      intersectionObserver.observe(canvas);

      if (isInView) {
        animationFrameId = requestAnimationFrame(animate);
      }
    }

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (intersectionObserver) {
        intersectionObserver.disconnect();
      }
    };
  }, [setupCanvas, updateSquares, drawGrid, width, height, isInView]);

  return (
    <div
      ref={containerRef}
      className={cn(`h-full w-full`, className)}
      {...props}
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none"
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
        }}
      />
    </div>
  );
};
