import { ChevronLeft, ChevronRight, X } from "lucide-react";

export default function Tour({ steps, step, onStep, onClose }) {
  const s = steps[step];
  const last = step === steps.length - 1;
  return (
    <section className="glass tour" aria-live="polite" aria-label="Guided tour">
      <div className="tour-head">
        <p className="label">Tour · {step + 1} / {steps.length}</p>
        <button className="icon-btn" onClick={onClose} aria-label="End tour"><X size={15} /></button>
      </div>
      <div className="fade" key={step}>
        <h3>{s.title}</h3>
        <p className="prose">{s.text}</p>
      </div>
      <div className="tour-nav">
        <div className="dots" aria-hidden="true">
          {steps.map((_, i) => <span key={i} className={i === step ? "on" : ""} />)}
        </div>
        <button className="tour-btn ghost" onClick={() => onStep(step - 1)} disabled={step === 0}>
          <ChevronLeft size={15} /> Back
        </button>
        <button className="tour-btn" onClick={() => (last ? onClose() : onStep(step + 1))}>
          {last ? "Explore" : "Next"} {!last && <ChevronRight size={15} />}
        </button>
      </div>
    </section>
  );
}
