/**
 * Generates an OKLCH color string with fixed lightness, chroma, and a random hue.
 * @returns {string} - The generated OKLCH color string.
 */
export function generateOklchColor(): string {
  // Generate a random number between 30 and 360 for the hue
  const hue = Math.floor(Math.random() * (360 - 30 + 1)) + 30;

  // Fixed lightness and chroma values
  const lightness = 66;
  const chroma = 0.1835;

  // Construct the OKLCH color string
  const oklchColor = `oklch(${lightness}% ${chroma} ${hue})`;

  return oklchColor;
}

export function getTailwindColor(name: string): string {
  // Generate a hash value for the input name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Ensure hash value is within the range of colors array
  const index = Math.abs(hash) % 12;

  return `var(--custom-color-${index + 1})`;
}
