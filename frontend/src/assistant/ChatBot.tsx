// components/ChatBot.tsx
import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Trash2 } from 'lucide-react'; 
import ReactMarkdown from 'react-markdown';
import { useSupabase } from '../context/SupabaseSessionContext';

interface Message {
  id: number;
  text: string;
  isUser: boolean;
  timestamp: Date;
  type?: 'task_created' | 'needs_clarification' | 'error' | 'info';
}

interface ChatBotProps {
  isOpen: boolean;
  onClose: () => void;
}

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  type?: string;
}

const ChatBot: React.FC<ChatBotProps> = ({ isOpen, onClose }) => {
  const { session, supabase } = useSupabase();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [clarificationState, setClarificationState] = useState<{
    active: boolean;
    partialTask: any;
    originalMessage: string;
  }>({ active: false, partialTask: null, originalMessage: '' });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const getWelcomeMessage = (): Message => ({
    id: 1,
    text: "Hello! I'm your AI Executive Assistant. I can help you manage tasks and schedule. You can say things like:\n\n- \"Create a task to finish the report by Friday\"\n- \"Add 'prepare presentation slides' as high priority\"\n- \"Remind me to call John tomorrow\"",
    isUser: false,
    timestamp: new Date(),
  });

  const getSignInWelcomeMessage = (): Message => ({
    id: 1,
    text: "🔐 Please sign in to use the AI Assistant. The chat feature is only available for signed-in users.",
    isUser: false,
    timestamp: new Date(),
    type: 'info'
  });

  const loadChatHistory = async (): Promise<void> => {
    if (!session?.user?.id) {
      setMessages([getSignInWelcomeMessage()]);
      setIsLoadingHistory(false);
      return;
    }

    setIsLoadingHistory(true);
    
    try {
      const { data: chatData, error } = await supabase
        .from('user_chats')
        .select('messages')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading chat history:', error);
        throw error;
      }

      if (chatData?.messages && Array.isArray(chatData.messages)) {
        const loadedMessages: Message[] = chatData.messages.map((msg: any, index: number) => ({
          id: index,
          text: msg.content,
          isUser: msg.role === 'user',
          timestamp: new Date(msg.timestamp),
          type: msg.type
        }));

        if (loadedMessages.length === 0) {
          setMessages([getWelcomeMessage()]);
        } else {
          setMessages(loadedMessages);
        }
      } else {
        const welcomeMessage = getWelcomeMessage();
        setMessages([welcomeMessage]);
        await saveMessagesToDB([welcomeMessage]);
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
      setMessages([getWelcomeMessage()]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const saveMessagesToDB = async (messagesToSave: Message[]): Promise<boolean> => {
    if (!session?.user?.id) return false;

    try {
      const storedMessages = messagesToSave.map(msg => ({
        role: msg.isUser ? 'user' : 'assistant',
        content: msg.text,
        timestamp: msg.timestamp.toISOString(),
        type: msg.type,
      }));

      const { error } = await supabase
        .from('user_chats')
        .upsert({
          user_id: session.user.id,
          messages: storedMessages,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Failed to save chat to database:', error);
      try {
        localStorage.setItem(`chat_backup_${session.user.id}`, JSON.stringify(messagesToSave));
      } catch {}
      return false;
    }
  };

  const clearChatHistory = async (): Promise<void> => {
    if (!session?.user?.id || !confirm('Clear all chat history?')) return;

    try {
      const welcomeMessage = getWelcomeMessage();
      setMessages([welcomeMessage]);
      await saveMessagesToDB([welcomeMessage]);
      localStorage.removeItem(`chat_backup_${session.user.id}`);
    } catch (error) {
      console.error('Failed to clear chat history:', error);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadChatHistory();
    }
  }, [isOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (): Promise<void> => {
    if (!session) {
      const signInMessage: Message = {
        id: Date.now(),
        text: "Please sign in to use the chat feature.",
        isUser: false,
        timestamp: new Date(),
        type: 'info'
      };
      setMessages(prev => [...prev, signInMessage]);
      return;
    }

    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now(),
      text: inputText,
      isUser: true,
      timestamp: new Date(),
    };

    // Create updated messages array with user message
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    const currentInput = inputText;
    setInputText('');
    setIsLoading(true);

    try {
      // If we're in clarification mode, just send the clarification as a regular message
      // The backend will handle it through the same /api/chat endpoint
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      // Add authorization header if user is signed in
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      } else {
        console.log('User not signed in, proceeding without auth token.');
      }

      const requestBody: any = {
        message: currentInput,
      };

      if (clarificationState.active) {
        console.log('Sending clarification response to backend:', currentInput);
        requestBody.context = 'clarification';
        requestBody.partialTask = clarificationState.partialTask;
      }

      const API_BASE_URL =
        import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      console.log('ChatBot received:', data);

      let messageType: Message['type'];
      if (data.task_created) {
        messageType = 'task_created';
      } else if (data.needs_clarification) {
        messageType = 'needs_clarification';
      } else if (data.ready_to_create) {
        messageType = !session ? 'info' : 'task_created';
      }

      let responseText = data.response;

      // If task is ready but user not signed in, add sign in prompt
      if (data.ready_to_create && !session) {
        responseText += "\n\n🔐 Please sign in to save this task to your list.";
      }

      const botMessage: Message = {
        id: Date.now() + 1,
        text: responseText,
        isUser: false,
        timestamp: new Date(),
        type: messageType,
      };

      // Create final messages array with bot response
      const finalMessages = [...updatedMessages, botMessage];
      setMessages(finalMessages);

      // Save to database after receiving bot response
      await saveMessagesToDB(finalMessages);

      if (data.needs_clarification) {
        setClarificationState({
          active: true,
          partialTask: data.partial_task,
          originalMessage: currentInput
        });
      } else {
        // Reset clarification state if we're not in clarification mode anymore
        setClarificationState({ active: false, partialTask: null, originalMessage: '' });
      }

    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: Date.now() + 1,
        text: "I'm sorry, I'm having trouble connecting right now. Please try again later.",
        isUser: false,
        timestamp: new Date(),
        type: 'error',
      };
      
      const finalMessages = [...messages, errorMessage];
      setMessages(finalMessages);
      
      // Save error message too
      await saveMessagesToDB(finalMessages);
      
      setClarificationState({ active: false, partialTask: null, originalMessage: '' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Markdown component for rendering formatted text
  const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
    return (
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 text-gray-900">{children}</h1>,
          h2: ({ children }) => <h2 className="text-md font-semibold mt-3 mb-2 text-gray-800">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-gray-700">{children}</h3>,
          p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-700">{children}</em>,
          code: ({ children }) => <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">{children}</code>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-indigo-300 pl-3 py-1 my-2 text-gray-600">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  const getMessageStyle = (type: Message['type'], isUser: boolean) => {
    if (isUser) {
      return 'bg-indigo-600 text-white rounded-br-none';
    }

    switch (type) {
      case 'task_created':
        return 'bg-green-100 text-green-800 rounded-bl-none border border-green-200';
      case 'needs_clarification':
        return 'bg-yellow-100 text-yellow-800 rounded-bl-none border border-yellow-200';
      case 'error':
        return 'bg-red-100 text-red-800 rounded-bl-none border border-red-200';
      case 'info':
        return 'bg-blue-100 text-blue-800 rounded-bl-none border border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 rounded-bl-none';
    }
  };

  const getTimestampStyle = (type: Message['type'], isUser: boolean) => {
    if (isUser) return 'text-indigo-200';

    switch (type) {
      case 'task_created':
        return 'text-green-600';
      case 'needs_clarification':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      case 'info':
        return 'text-blue-600';
      default:
        return 'text-gray-500';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 w-[500px] h-[700px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50">
      {/* Header - UPDATED with loading indicator and clear button */}
      <div className="bg-indigo-600 text-white p-4 rounded-t-2xl flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Bot className="w-6 h-6" />
          <h3 className="font-semibold text-lg">AI Executive Assistant</h3>
          {isLoadingHistory && (
            <span className="text-xs bg-indigo-500 px-2 py-1 rounded animate-pulse">
              Loading...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!session && (
            <span className="text-xs bg-yellow-500 px-2 py-1 rounded">Sign in to save tasks</span>
          )}
          {session && messages.length > 1 && (
            <button
              onClick={clearChatHistory}
              className="text-white hover:text-red-200 transition-colors text-xs"
              aria-label="Clear chat history"
              title="Clear chat history"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 transition-colors"
            aria-label="Close chat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages - UPDATED with loading state */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoadingHistory ? (
          <div className="flex justify-center items-center h-full">
            <div className="text-gray-500">Loading chat history...</div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`flex items-start gap-3 max-w-[85%] ${message.isUser ? 'flex-row-reverse' : 'flex-row'
                    }`}
                >
                  <div
                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${message.isUser
                        ? 'bg-indigo-100 text-indigo-600'
                        : 'bg-gray-100 text-gray-600'
                      }`}
                  >
                    {message.isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                  </div>
                  <div
                    className={`px-4 py-3 rounded-2xl ${getMessageStyle(message.type, message.isUser)}`}
                  >
                    {message.isUser ? (
                      <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                    ) : (
                      <div className="text-sm">
                        <MarkdownRenderer content={message.text} />
                      </div>
                    )}
                    <p className={`text-xs mt-2 ${getTimestampStyle(message.type, message.isUser)}`}>
                      {message.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-start gap-3 max-w-[85%]">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-bl-none px-4 py-3">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input - UPDATED disabled states */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <textarea
            value={inputText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={
              clarificationState.active
                ? "Provide the missing information..."
                : "Ask me about your schedule, tasks, or say 'Create a task to...'"
            }
            className="flex-1 border border-gray-300 rounded-lg px-3 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={2}
            disabled={isLoading || isLoadingHistory || !session} 
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputText.trim() || isLoading || !session || isLoadingHistory} // UPDATED
            className="bg-indigo-600 text-white p-3 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center self-end"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2 text-center">
          {clarificationState.active
            ? "Answer the question above to complete task creation"
            : "Press Enter to send, Shift+Enter for new line"
          }
        </p>
        {!session && (
          <p className="text-xs text-yellow-600 mt-1 text-center">
            🔐 Sign in to save tasks to your list
          </p>
        )}
      </div>
    </div>
  );
};

export default ChatBot;