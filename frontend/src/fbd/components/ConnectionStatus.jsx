// components/ConnectionStatus.jsx — Live socket connection indicator
import React from 'react';
import { useSocket } from '../hooks/useSocket';

export default function ConnectionStatus() {
  const { connected } = useSocket();
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={connected ? 'connection-dot-connected' : 'connection-dot-disconnected'} />
      <span className={connected ? 'text-green-700' : 'text-red-600 font-medium'}>
        {connected ? 'Live' : 'Disconnected'}
      </span>
    </div>
  );
}
