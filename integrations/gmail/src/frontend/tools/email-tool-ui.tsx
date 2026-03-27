import React, { useState } from 'react';
import type {
  ToolUI,
  ToolInput,
  ToolResult,
  ToolUIRenderContext,
  ToolUIComponent,
} from '@redplanethq/sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailInput {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

// ─── Phase 1: Editable compose form ──────────────────────────────────────────

function EmailComposeForm({
  toolName,
  initialInput,
  submitInput,
}: {
  toolName: string;
  initialInput: EmailInput;
  submitInput: (input: ToolInput) => void;
}) {
  const [to, setTo] = useState(initialInput.to.join(', '));
  const [subject, setSubject] = useState(initialInput.subject);
  const [body, setBody] = useState(initialInput.body);
  const [cc, setCc] = useState((initialInput.cc ?? []).join(', '));

  const isDraft = toolName === 'draft_email';
  const label = isDraft ? 'Save Draft' : 'Send';

  const handleSubmit = () => {
    submitInput({
      ...initialInput,
      to: to
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      subject,
      body,
      ...(cc
        ? {
            cc: cc
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
          }
        : {}),
    } as ToolInput);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--muted-foreground)', fontWeight: 500 }}>
          To
        </label>
        <input
          value={to}
          onChange={e => setTo(e.target.value)}
          style={inputStyle}
          placeholder="recipient@example.com"
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--muted-foreground)', fontWeight: 500 }}>
          CC
        </label>
        <input
          value={cc}
          onChange={e => setCc(e.target.value)}
          style={inputStyle}
          placeholder="cc@example.com"
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--muted-foreground)', fontWeight: 500 }}>
          Subject
        </label>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          style={inputStyle}
          placeholder="Subject"
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--muted-foreground)', fontWeight: 500 }}>
          Body
        </label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={6}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder="Email body..."
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleSubmit} style={buttonStyle}>
          {label}
        </button>
      </div>
    </div>
  );
}

// ─── Phase 2: Result view ─────────────────────────────────────────────────────

function EmailResultView({ toolName, result }: { toolName: string; result: ToolResult }) {
  const text = result.content[0]?.text ?? '';
  const isDraft = toolName === 'draft_email';
  const success = !result.isError;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <span style={{ fontSize: 16 }}>{success ? (isDraft ? '📝' : '✉️') : '⚠️'}</span>
      <span style={{ fontSize: 13, color: success ? 'var(--foreground)' : 'var(--destructive)' }}>
        {text || (success ? (isDraft ? 'Draft saved' : 'Email sent') : 'Failed')}
      </span>
    </div>
  );
}

// ─── Inline styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--background)',
  color: 'var(--foreground)',
  boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 4,
  border: 'none',
  background: 'var(--foreground)',
  color: 'var(--background)',
  cursor: 'pointer',
};

// ─── ToolUI export ────────────────────────────────────────────────────────────

export const emailToolUI: ToolUI = {
  supported_tools: ['send_email', 'draft_email'],

  async render(
    toolName: string,
    input: ToolInput,
    result: ToolResult | null,
    _context: ToolUIRenderContext,
    submitInput: (input: ToolInput) => void
  ): Promise<ToolUIComponent> {
    const emailInput = input as unknown as EmailInput;

    if (result === null) {
      // Phase 1: editable compose form
      return function EmailCompose() {
        return (
          <EmailComposeForm
            toolName={toolName}
            initialInput={emailInput}
            submitInput={submitInput}
          />
        );
      };
    }

    // Phase 2: result view
    return function EmailResult() {
      return <EmailResultView toolName={toolName} result={result} />;
    };
  },
};
