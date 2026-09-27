/** In-match chat: recent messages fade out; T/Enter (see useMatchKeys) opens the input. */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { session } from '../../session/Session';
import { useT } from '../../i18n';
import { useClock } from '../hooks/useClock';
import { CHAT_FADE_MS } from '../logic/constants';

export function ChatOverlay() {
  const t = useT();
  const chat = useStore((s) => s.chat);
  const open = useStore((s) => s.chatOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const now = useClock(1000, !open && chat.length > 0);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setText('');
  }, [open]);

  const visible = open ? chat.slice(-8) : chat.filter((m) => now - m.time < CHAT_FADE_MS).slice(-6);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) session.sendChat(trimmed);
    setChatOpen(false);
  };

  return (
    <div className={`hud__chat${open ? ' hud__chat--open' : ''}`} data-testid="hud-chat">
      {visible.map((m) => (
        <div key={m.id} className={`hud__chat-msg team-${m.team}`}>
          <span className="hud__chat-who">{m.name}</span>
          <span>{m.text}</span>
        </div>
      ))}
      {open && (
        <input
          ref={inputRef}
          className="input hud__chat-input interactive"
          value={text}
          maxLength={200}
          placeholder={t('hud.chatPlaceholder')}
          aria-label={t('lobby.chat')}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setChatOpen(false)}
          onKeyDown={(e) => {
            // Keep gameplay keys typed into the chat from reaching game listeners on the bubble path.
            e.stopPropagation();
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') setChatOpen(false);
          }}
          data-testid="hud-chat-input"
        />
      )}
    </div>
  );
}
