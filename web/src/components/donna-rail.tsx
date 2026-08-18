import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, PanelLeftClose, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DonnaConversationMessage } from "../../../src/runtime/project-runtime.js";
import type { CodexModelOption } from "../../../src/runners/codex-models.js";

export type DonnaRailProps = {
  projectName: string;
  messages?: DonnaConversationMessage[];
  model?: string;
  models?: CodexModelOption[];
  onModelChange?(model: string): Promise<void>;
  onSend(message: string): Promise<string>;
  onCollapse(): void;
};

export function DonnaRail({ projectName, messages = [], model = "gpt-5.6-luna", models = [], onModelChange, onSend, onCollapse }: DonnaRailProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [fallbackMessages, setFallbackMessages] = useState<DonnaConversationMessage[]>([]);
  const visibleMessages = messages.length > 0 ? messages : fallbackMessages;
  const messagesElement = useRef<HTMLDivElement>(null);
  const modelPickerElement = useRef<HTMLDivElement>(null);
  const nativeModels = models.filter(option => option.source === "Codex");
  const routerModels = models.filter(option => option.source === "Codex Router");

  useEffect(() => {
    const element = messagesElement.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [visibleMessages.length, sending]);

  useEffect(() => {
    if (!modelOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!modelPickerElement.current?.contains(event.target as Node)) setModelOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelOpen]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = message.trim();
    if (!value || sending) return;
    setMessage("");
    if (messages.length === 0) setFallbackMessages(current => [...current, localMessage("user", value)]);
    setSending(true);
    try {
      const reply = await onSend(value);
      if (messages.length === 0) setFallbackMessages(current => [...current, localMessage("donna", reply)]);
    } catch {
      // The shared project error banner reports failed turns without creating fake history.
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="donna-rail" aria-label="Donna project manager">
      <header className="donna-header">
        <div className="donna-mark"><Sparkles size={15} /></div>
        <div><strong>Donna</strong><span>{sending ? "Thinking" : "Available"}</span></div>
        <span className={`presence-dot ${sending ? "presence-dot--busy" : ""}`} />
        <button type="button" className="donna-collapse" aria-label="Collapse Donna (⌘B)" onClick={onCollapse} title="Collapse Donna (⌘B)">
          <PanelLeftClose size={15} />
        </button>
      </header>
      <div className="donna-messages" aria-live="polite" ref={messagesElement}>
        {(visibleMessages.length > 0 ? visibleMessages : [{
          id: "welcome",
          author: "donna" as const,
          text: `I’m Donna. I’ll coordinate ${projectName}, keep work moving, and surface decisions that need you.`
        }]).map(item => (
          <div key={item.id} className={`donna-message donna-message--${item.author}`}>
            <span>{item.author === "donna" ? "Donna" : "You"}</span>
            <div className="donna-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
            </div>
          </div>
        ))}
        {sending && <div className="typing-indicator" aria-label="Donna is thinking"><i /><i /><i /></div>}
      </div>
      <form className="donna-composer" onSubmit={event => void submit(event)}>
        <div className="donna-composer__toolbar">
          <label htmlFor="donna-message">Message Donna</label>
          <div className="donna-model" ref={modelPickerElement}>
            <span>Model</span>
            <button type="button" className="donna-model__trigger" aria-haspopup="listbox" aria-expanded={modelOpen} onClick={() => setModelOpen(open => !open)}>
              {models.find(option => option.id === model)?.label ?? model}<ChevronDown size={11} />
            </button>
            {modelOpen && (
              <div className="donna-model__menu" role="listbox" aria-label="Available Donna models">
                {!models.some(option => option.id === model) && <ModelOption id={model} label={model} active onSelect={() => setModelOpen(false)} />}
                <ModelGroup label="Codex" options={nativeModels} activeModel={model} onSelect={selected => {
                  setModelOpen(false);
                  void onModelChange?.(selected);
                }} />
                <ModelGroup label="Codex Router" options={routerModels} activeModel={model} onSelect={selected => {
                  setModelOpen(false);
                  void onModelChange?.(selected);
                }} />
              </div>
            )}
          </div>
        </div>
        <textarea
          id="donna-message"
          value={message}
          onChange={event => setMessage(event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          placeholder="Ask Donna to plan or assign work…"
          rows={3}
        />
        <button type="submit" aria-label="Send message" disabled={!message.trim() || sending}><ArrowUp size={16} /></button>
      </form>
    </aside>
  );
}

function ModelGroup({ label, options, activeModel, onSelect }: {
  label: string;
  options: CodexModelOption[];
  activeModel: string;
  onSelect(model: string): void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="donna-model__group" role="group" aria-label={label}>
      <span>{label}</span>
      {options.map(option => (
        <ModelOption key={option.id} id={option.id} label={option.label} active={option.id === activeModel} onSelect={onSelect} />
      ))}
    </div>
  );
}

function ModelOption({ id, label, active, onSelect }: {
  id: string;
  label: string;
  active: boolean;
  onSelect(model: string): void;
}) {
  return (
    <button type="button" role="option" aria-selected={active} onClick={() => onSelect(id)}>
      <span>{label}</span>{active && <Check size={13} />}
    </button>
  );
}

function localMessage(author: "user" | "donna", text: string): DonnaConversationMessage {
  return { id: crypto.randomUUID(), author, text, source: "browser", createdAt: new Date().toISOString() };
}
