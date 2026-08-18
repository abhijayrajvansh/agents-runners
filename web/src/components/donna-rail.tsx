import { FormEvent, useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";

type Message = { id: string; author: "user" | "donna"; text: string };

export type DonnaRailProps = {
  projectName: string;
  onSend(message: string): Promise<string>;
};

export function DonnaRail({ projectName, onSend }: DonnaRailProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome",
    author: "donna",
    text: `I’m Donna. I’ll coordinate ${projectName}, keep work moving, and surface decisions that need you.`
  }]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = message.trim();
    if (!value || sending) return;
    setMessage("");
    setMessages(current => [...current, { id: crypto.randomUUID(), author: "user", text: value }]);
    setSending(true);
    try {
      const reply = await onSend(value);
      setMessages(current => [...current, { id: crypto.randomUUID(), author: "donna", text: reply }]);
    } catch (caught) {
      setMessages(current => [...current, {
        id: crypto.randomUUID(),
        author: "donna",
        text: caught instanceof Error ? caught.message : "Donna could not complete that turn."
      }]);
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
      </header>
      <div className="donna-context">
        <span>Project manager</span>
        <p>Shared across browser, terminal, and Codex sessions.</p>
      </div>
      <div className="donna-messages" aria-live="polite">
        {messages.map(item => (
          <div key={item.id} className={`donna-message donna-message--${item.author}`}>
            <span>{item.author === "donna" ? "Donna" : "You"}</span>
            <p>{item.text}</p>
          </div>
        ))}
        {sending && <div className="typing-indicator" aria-label="Donna is thinking"><i /><i /><i /></div>}
      </div>
      <form className="donna-composer" onSubmit={event => void submit(event)}>
        <label htmlFor="donna-message">Message Donna</label>
        <textarea
          id="donna-message"
          value={message}
          onChange={event => setMessage(event.target.value)}
          placeholder="Ask Donna to plan or assign work…"
          rows={3}
        />
        <button type="submit" aria-label="Send message" disabled={!message.trim() || sending}><ArrowUp size={16} /></button>
      </form>
    </aside>
  );
}
