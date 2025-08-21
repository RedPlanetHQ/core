import { type GraphClusteringVisualizationProps } from "./graph-clustering-visualization";
import { useState, useEffect } from "react";

export function GraphVisualizationClient(
  props: GraphClusteringVisualizationProps,
) {
  const [Component, setComponent] = useState<any>(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;

    import("./graph-clustering-visualization").then(
      ({ GraphClusteringVisualization }) => {
        setComponent(GraphClusteringVisualization);
      },
    );
  }, []);

  if (!Component) {
    return null;
  }

  return <Component {...props} />;
}
