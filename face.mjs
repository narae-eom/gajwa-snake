// Pure timing function so face motion can be tested independently of canvas rendering.
export function faceMotion({running, eating, progress, now, gulpStart, reducedMotion = false}) {
  if (!running) return {mouth: 0, tongue: 0};
  if (reducedMotion) return {mouth: eating ? .7 : 0, tongue: 0};
  const a = Math.max(0, Math.min(1, progress));
  const bite = eating ? Math.sin(Math.PI * Math.max(0, Math.min(1, (a - .05) / .9))) : 0;
  const age = now - gulpStart;
  const chew = !eating && age >= 0 && age < 180 ? .3 * Math.sin(Math.PI * age / 180) : 0;
  const mouth = Math.max(bite, chew);
  const phase = (((now % 1450) + 1450) % 1450) / 1450;
  const tongue = !eating && mouth < .05 && phase < .26 ? Math.sin(Math.PI * phase / .26) : 0;
  return {mouth, tongue};
}
