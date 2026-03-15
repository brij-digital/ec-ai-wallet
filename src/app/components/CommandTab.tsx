import type { FormEvent } from 'react';

export type CommandMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

type CommandTabProps = {
  messages: CommandMessage[];
  isWorking: boolean;
  commandInput: string;
  onCommandInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPrefillMetaRun: () => void;
};

export function CommandTab(props: CommandTabProps) {
  const {
    messages,
    isWorking,
    commandInput,
    onCommandInputChange,
    onSubmit,
    onPrefillMetaRun,
  } = props;

  return (
    <>
      <div className="chat-log" aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <p>{message.text}</p>
          </article>
        ))}
      </div>
      <form className="command-form" onSubmit={onSubmit}>
        <input
          type="text"
          value={commandInput}
          onChange={(event) => onCommandInputChange(event.target.value)}
          placeholder="/meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate"
          disabled={isWorking}
          aria-label="Command input"
        />
        <button type="submit" disabled={isWorking}>
          {isWorking ? 'Running...' : 'Run'}
        </button>
      </form>
      <div className="quick-actions">
        <button type="button" onClick={onPrefillMetaRun} disabled={isWorking}>
          Prefill Meta Run
        </button>
      </div>
    </>
  );
}

