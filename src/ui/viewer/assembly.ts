/** Presentation-only layer offsets. Exported geometry always stays in mounting coordinates. */
export function assemblyOffsets(progress: number, size: number) {
  const p = Math.max(0, Math.min(1, progress));
  const scale = Math.max(size, 60);
  return { plate: -p * scale * 0.26, cover: p * scale * 0.08, bilresa: p * scale * 0.62 };
}
