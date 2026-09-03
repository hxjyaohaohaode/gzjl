import { useMemo, useRef, useState } from "react";

import { hexToHsv, hsvToHex, sanitizeAccent } from "./color.js";

const presets = [
  "#5b5ce2",
  "#2476d4",
  "#008d77",
  "#0d8a54",
  "#ba6d00",
  "#c34359",
  "#a144c7",
  "#2a8796",
  "#384152",
  "#9a5b2d",
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * A controlled HSV picker. The same persisted hex value drives the handle,
 * preview, native color-input fallback, and application CSS token, so the UI
 * never shows a pointer for one color while rendering another.
 */
export function AccentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const spectrumRef = useRef<HTMLDivElement>(null);
  const [hexDraftState, setHexDraftState] = useState({
    sourceValue: value,
    draft: value,
  });
  const hsv = useMemo(() => hexToHsv(value), [value]);
  // Do not synchronize draft state with an effect: the parent value is the
  // source of truth, and a stale draft is simply ignored after a spectrum,
  // preset, or native-picker change. Invalid typed text remains visible until
  // blur so users can finish a complete HEX value naturally.
  const hexDraft =
    hexDraftState.sourceValue === value ? hexDraftState.draft : value;

  const setSaturationAndValue = (clientX: number, clientY: number) => {
    const rect = spectrumRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const saturation = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
    const nextValue = clamp(100 - ((clientY - rect.top) / rect.height) * 100, 0, 100);
    onChange(hsvToHex({ hue: hsv.hue, saturation, value: nextValue }));
  };

  return (
    <div className="accent-picker" aria-label="自定义强调色">
      <div
        aria-label="饱和度与明度"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(hsv.saturation)}
        aria-valuetext={`色相 ${Math.round(hsv.hue)} 度，饱和度 ${Math.round(hsv.saturation)}%，明度 ${Math.round(hsv.value)}%`}
        className="accent-picker-spectrum"
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 2;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onChange(
              hsvToHex({
                ...hsv,
                saturation: clamp(hsv.saturation - step, 0, 100),
              }),
            );
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onChange(
              hsvToHex({
                ...hsv,
                saturation: clamp(hsv.saturation + step, 0, 100),
              }),
            );
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            onChange(
              hsvToHex({ ...hsv, value: clamp(hsv.value + step, 0, 100) }),
            );
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onChange(
              hsvToHex({ ...hsv, value: clamp(hsv.value - step, 0, 100) }),
            );
          }
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setSaturationAndValue(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            setSaturationAndValue(event.clientX, event.clientY);
        }}
        ref={spectrumRef}
        role="slider"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.hue} 100% 50%))`,
        }}
        tabIndex={0}
      >
        <span
          aria-hidden="true"
          className="accent-picker-handle"
          style={{
            left: `${hsv.saturation}%`,
            top: `${100 - hsv.value}%`,
          }}
        />
      </div>
      <label className="accent-picker-hue">
        <span>色相</span>
        <input
          aria-label="色相"
          max="360"
          min="0"
          onChange={(event) =>
            onChange(
              hsvToHex({ ...hsv, hue: Number(event.target.value) || 0 }),
            )
          }
          style={{
            background:
              "linear-gradient(90deg, #f00 0%, #ff0 16.7%, #0f0 33.3%, #0ff 50%, #00f 66.7%, #f0f 83.3%, #f00 100%)",
          }}
          type="range"
          value={Math.round(hsv.hue)}
        />
      </label>
      <div className="accent-picker-controls">
        <label className="accent-picker-hex">
          <span>HEX</span>
          <input
            aria-label="强调色 HEX 值"
            inputMode="text"
            maxLength={7}
            onBlur={() =>
              setHexDraftState({ sourceValue: value, draft: value })
            }
            onChange={(event) => {
              const next = event.target.value.trim();
              if (/^#[0-9a-f]{6}$/i.test(next)) {
                const normalized = sanitizeAccent(next);
                setHexDraftState({
                  sourceValue: normalized,
                  draft: normalized,
                });
                onChange(normalized);
                return;
              }
              setHexDraftState({ sourceValue: value, draft: next });
            }}
            spellCheck={false}
            value={hexDraft}
          />
        </label>
        <label className="accent-picker-native">
          <span className="sr-only">系统取色器</span>
          <input
            aria-label="系统取色器"
            onChange={(event) => onChange(sanitizeAccent(event.target.value))}
            type="color"
            value={value}
          />
        </label>
      </div>
      <div aria-label="预设强调色" className="accent-picker-presets">
        {presets.map((preset) => (
          <button
            aria-label={`使用强调色 ${preset}`}
            className={preset === value ? "is-selected" : ""}
            key={preset}
            onClick={() => onChange(preset)}
            style={{ backgroundColor: preset }}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}
