import { useEffect, useRef, useState } from "react";
export interface Field {
  name: string;
  label: string;
  value: string | number;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
}
export interface DialogSpec {
  title: string;
  description?: string;
  fields: Field[];
  submit: string;
  apply: (values: Record<string, string>) => boolean | void;
}
export function CommandDialog({
  spec,
  close,
}: {
  spec: DialogSpec;
  close: () => void;
}) {
  const [failure, setFailure] = useState(""),
    [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(spec.fields.map((f) => [f.name, String(f.value)])),
    ),
    ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    (
      (ref.current?.querySelector("input,select") ??
        ref.current?.querySelector("button")) as HTMLElement
    )?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <form
        ref={ref}
        className="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (spec.apply(values) !== false) close();
            else
              setFailure(
                "Could not apply these values. Check the range and score contents, then try again.",
              );
          } catch (error) {
            setFailure(String(error instanceof Error ? error.message : error));
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
          if (e.key === "Tab") {
            const fields = [
                ...e.currentTarget.querySelectorAll<HTMLElement>(
                  "input,select,button",
                ),
              ],
              first = fields[0],
              last = fields.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="dialog-heading">
          <h2>{spec.title}</h2>
          <button type="button" aria-label="Close dialog" onClick={close}>
            ×
          </button>
        </div>
        {spec.description && <p>{spec.description}</p>}
        {spec.fields.map((f) => (
          <label key={f.name}>
            {f.label}
            {f.options ? (
              <select
                name={f.name}
                value={values[f.name]}
                onChange={(e) =>
                  setValues({ ...values, [f.name]: e.target.value })
                }
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.name}
                required={typeof f.value === "number"}
                type={typeof f.value === "number" ? "number" : "text"}
                min={f.min}
                max={f.max}
                step={f.step ?? 1}
                value={values[f.name]}
                onChange={(e) =>
                  setValues({ ...values, [f.name]: e.target.value })
                }
              />
            )}
          </label>
        ))}
        <div role="alert">{failure}</div>
        <div className="dialog-actions">
          {spec.fields.length > 0 && (
            <button type="button" onClick={close}>
              Cancel
            </button>
          )}
          <button type="submit" className="accent">
            {spec.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
