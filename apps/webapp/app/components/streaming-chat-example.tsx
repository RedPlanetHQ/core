/**
 * Example: React component showing streaming subagent progress with useChat
 *
 * This demonstrates how to render the streaming orchestrator work
 * while the parent core-agent is thinking
 */

'use client';

import { useChat } from '@ai-sdk/react';
import type { CoreAgentMessage, CoreAgentToolPart } from '~/services/agent/types';
import { isStreaming, isComplete, hasOutput } from '~/services/agent/types';

export function StreamingChatExample() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat<CoreAgentMessage>({
      api: '/api/v1/conversation',
    });

  return (
    <div className="flex flex-col h-screen">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            {message.parts.map((part, i) => {
              // Render text parts
              if (part.type === 'text') {
                return (
                  <div
                    key={i}
                    className={`p-3 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-100 ml-auto max-w-[80%]'
                        : 'bg-gray-100 mr-auto max-w-[80%]'
                    }`}
                  >
                    <p className="text-sm">{part.text}</p>
                  </div>
                );
              }

              // Render subagent tool calls (gather_context or take_action)
              if (
                part.type === 'tool-gather_context' ||
                part.type === 'tool-take_action'
              ) {
                const toolPart = part as CoreAgentToolPart;
                const toolName =
                  part.type === 'tool-gather_context'
                    ? 'Gathering Context'
                    : 'Taking Action';

                return (
                  <div key={i} className="bg-white border rounded-lg p-4 shadow-sm">
                    {/* Tool header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-sm">{toolName}</span>
                      {isStreaming(toolPart) && (
                        <span className="text-xs text-blue-600 animate-pulse">
                          Working...
                        </span>
                      )}
                      {isComplete(toolPart) && (
                        <span className="text-xs text-green-600">✓ Complete</span>
                      )}
                    </div>

                    {/* Show tool input */}
                    {toolPart.state !== 'input-streaming' && toolPart.input && (
                      <div className="text-xs text-gray-600 mb-3 p-2 bg-gray-50 rounded">
                        <strong>Query:</strong>{' '}
                        {toolPart.input.query || toolPart.input.action}
                      </div>
                    )}

                    {/* Show orchestrator's streaming work */}
                    {hasOutput(toolPart) && toolPart.output && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-gray-500 uppercase">
                          Orchestrator Activity:
                        </div>
                        {toolPart.output.parts.map((nestedPart, j) => {
                          // Show text from orchestrator
                          if (nestedPart.type === 'text') {
                            return (
                              <div
                                key={j}
                                className="text-sm p-2 bg-blue-50 rounded border-l-2 border-blue-400"
                              >
                                {nestedPart.text}
                              </div>
                            );
                          }

                          // Show orchestrator tool calls (memory_search, integration_query, web_search, etc.)
                          if (nestedPart.type?.startsWith('tool-')) {
                            const subToolName = nestedPart.type
                              .replace('tool-', '')
                              .replace(/_/g, ' ')
                              .replace(/\b\w/g, (l) => l.toUpperCase());

                            return (
                              <div
                                key={j}
                                className="text-xs p-2 bg-purple-50 rounded border border-purple-200"
                              >
                                <div className="font-medium text-purple-700">
                                  🔧 {subToolName}
                                </div>
                                {(nestedPart as any).input && (
                                  <div className="text-gray-600 mt-1">
                                    {JSON.stringify((nestedPart as any).input, null, 2)}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return null;
                        })}
                      </div>
                    )}

                    {/* Show streaming indicator */}
                    {isStreaming(toolPart) && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
                          <div
                            className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                            style={{ animationDelay: '0.1s' }}
                          />
                          <div
                            className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                            style={{ animationDelay: '0.2s' }}
                          />
                        </div>
                        Processing...
                      </div>
                    )}
                  </div>
                );
              }

              return null;
            })}
          </div>
        ))}

        {isLoading && (
          <div className="text-sm text-gray-500 italic">Agent is thinking...</div>
        )}
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="border-t p-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask me anything..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Simplified version - Just show text summary
 */
export function SimplifiedStreamingChat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat<CoreAgentMessage>({
      api: '/api/v1/conversation',
    });

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            {message.parts.map((part, i) => {
              // Only show text parts (the subagent work is hidden from user, only seen by model)
              if (part.type === 'text') {
                return (
                  <div
                    key={i}
                    className={`p-3 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-100 ml-auto max-w-[80%]'
                        : 'bg-gray-100 mr-auto max-w-[80%]'
                    }`}
                  >
                    <p className="text-sm">{part.text}</p>
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="border-t p-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask me anything..."
            className="flex-1 px-4 py-2 border rounded-lg"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
