import { useEffect, useRef } from "react";

const BAR_W = 3;
const BAR_GAP = 1;
const FLOOR = 0.012;

interface Props {
  /** Level history owned by useRecorder. Read here, never rendered. */
  levels: React.RefObject<number[]>;
  /** One frame of metering. Called from this component's animation loop. */
  sample: () => void;
}

/**
 * Amplitude bars scrolling in from the right, like a chart recorder.
 *
 * Not decoration: an inspection runs half an hour, and this is the only way to
 * see that the microphone is actually hearing the room before the whole session
 * turns out to be silence. Drawn imperatively because a canvas at 60fps has no
 * business going through the React tree.
 */
export function Waveform({ levels, sample }: Props) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let frame = 0;

    const paint = () => {
      const element = canvas.current;
      if (!element) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const box = element.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width * dpr));
      const height = Math.max(1, Math.round(box.height * dpr));
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }

      const ctx = element.getContext("2d");
      if (!ctx) return;
      // The canvas, not the root: the recorder runs on the dark chrome
      // palette, which is scoped to .intake.live. Reading the root here drew
      // the light theme's colours onto a near-black ground.
      const css = getComputedStyle(element);
      ctx.clearRect(0, 0, width, height);

      const step = (BAR_W + BAR_GAP) * dpr;
      const slots = Math.floor(width / step);
      const shown = levels.current ? levels.current.slice(-slots) : [];

      // Centre line, so an empty or silent stretch still reads as a signal at rest.
      ctx.fillStyle = css.getPropertyValue("--line").trim() || "#ddd";
      ctx.fillRect(0, Math.round(height / 2), width, Math.max(1, Math.round(dpr)));

      const live = css.getPropertyValue("--brand").trim() || "#0b6b7f";
      const quiet = css.getPropertyValue("--ink-mute").trim() || "#888";
      const middle = height / 2;

      shown.forEach((level, index) => {
        // The exponent keeps quiet speech visible; raw RMS renders it flat.
        const bar = Math.max(dpr, Math.pow(Math.min(1, level * 3.2), 0.65) * height * 0.86);
        ctx.fillStyle = level < FLOOR ? quiet : live;
        ctx.fillRect(
          Math.round(width - (shown.length - index) * step),
          Math.round(middle - bar / 2),
          Math.max(1, Math.round(BAR_W * dpr)),
          Math.round(bar),
        );
      });
    };

    const loop = () => {
      frame = requestAnimationFrame(loop);
      sample();
      paint();
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [levels, sample]);

  return (
    <canvas
      ref={canvas}
      className="wave"
      role="img"
      aria-label="Live microphone level for the recording in progress"
    />
  );
}
