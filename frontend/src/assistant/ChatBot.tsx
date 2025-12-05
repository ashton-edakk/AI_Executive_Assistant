// components/ChatBot.tsx
import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Trash2, Mic, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useSupabase } from '../context/SupabaseSessionContext';

// Backend API URL - use environment variable or fallback to localhost
const API_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:8080';

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
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState<boolean>(false);
  const recognitionRef = useRef<any | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const getWelcomeMessage = (): Message => ({
    id: 1,
    text: "Hello! I'm your AI Executive Assistant. I can help you plan your tasks, schedule your day, and optimize your time.\n\nTry asking me things like:\n- \"Help me plan my day\"\n- \"Create a task to study for my exam on Friday\"\n- \"Add a task to finish my CS homework\"\n- \"Mark my 'Prepare slides' task as high priority\"\n- \"Remind me to call John tomorrow\"",
    isUser: false,
    timestamp: new Date(),
  });

  const getSignInWelcomeMessage = (): Message => ({
    id: 1,
    text: "🔐 Please sign in to use the AI Executive Assistant.\n\nOnce you're signed in, I can:\n- Remember your tasks\n- Help you plan your schedule\n- Create and organize tasks for you\n\nUse the sign in button in the top right corner to get started.",
    isUser: false,
    timestamp: new Date(),
  });

  const formatTaskCreatedMessage = (aiResponse: any): string => {
    if (!aiResponse?.parsed_task) return aiResponse?.response || "I created a task for you.";

    const { title, due_date, est_minutes, priority, notes } = aiResponse.parsed_task;

    let message = `✅ I created this task for you:\n\n**${title}**\n`;

    if (due_date) {
      message += `• **Due:** ${due_date}\n`;
    }

    if (est_minutes) {
      message += `• **Estimated time:** ${est_minutes} minutes\n`;
    }

    if (priority) {
      const priorityLabel =
        priority === 'high' ? 'High 🔴' :
          priority === 'med' ? 'Medium 🟡' :
            priority === 'low' ? 'Low 🟢' :
              priority;
      message += `• **Priority:** ${priorityLabel}\n`;
    }

    if (notes) {
      message += `\n📝 **Notes:**\n${notes}\n`;
    }

    message += `\nYou can view or edit this task on your Tasks page.`;

    return message;
  };

  const formatClarificationRequest = (aiResponse: any): string => {
    if (!aiResponse?.clarification_prompt) {
      return "I need a bit more information to create this task. Can you clarify what you mean?";
    }

    let message = `🤔 I need a bit more information:\n\n${aiResponse.clarification_prompt}\n`;

    if (aiResponse.missing_fields && aiResponse.missing_fields.length > 0) {
      message += `\nMissing details:\n`;
      aiResponse.missing_fields.forEach((field: string) => {
        message += `- ${field}\n`;
      });
    }

    message += `\nPlease reply with the missing information in one message.`;

    return message;
  };

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
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.error('Error loading chat history:', error);
        setMessages([getWelcomeMessage()]);
      } else if (chatData?.messages?.length) {
        const loadedMessages: Message[] = chatData.messages.map((msg: any, index: number) => ({
          id: msg.id || index + 1,
          text: msg.text,
          isUser: msg.isUser,
          timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
          type: msg.type,
        }));
        setMessages(loadedMessages);
      } else {
        setMessages([getWelcomeMessage()]);
      }
    } catch (error) {
      console.error('Unexpected error loading chat history:', error);
      setMessages([getWelcomeMessage()]);
    } finally {
      setIsLoadingHistory(false);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognitionCtor) {
      setIsSpeechSupported(true);
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  // Store what text was in input before voice started
  const preVoiceTextRef = useRef<string>('');

  const initRecognition = () => {
    if (recognitionRef.current) return;

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      console.warn('SpeechRecognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      // Build the full transcript from all results
      let finalTranscript = '';
      let interimTranscript = '';
      
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      
      // Use final if available, otherwise show interim
      const currentTranscript = (finalTranscript || interimTranscript).trim();
      if (!currentTranscript) return;

      // Replace (not append) the voice portion of the text
      const baseText = preVoiceTextRef.current;
      setInputText(baseText ? `${baseText} ${currentTranscript}` : currentTranscript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  };

  const handleVoiceToggle = () => {
    if (!isSpeechSupported) {
      alert('Speech recognition is not supported in this browser. Please try Chrome or Edge.');
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    // Save current input text before starting voice
    preVoiceTextRef.current = inputText;
    
    initRecognition();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error('Failed to start speech recognition:', err);
        setIsListening(false);
      }
    }
  };

  const saveChatHistory = async (updatedMessages: Message[]): Promise<void> => {
    if (!session?.user?.id) return;

    try {
      const messagesToSave = updatedMessages.map(msg => ({
        id: msg.id,
        text: msg.text,
        isUser: msg.isUser,
        timestamp: msg.timestamp.toISOString(),
        type: msg.type,
      }));

      const { error } = await supabase
        .from('user_chats')
        .upsert({
          user_id: session.user.id,
          messages: messagesToSave,
        }, { onConflict: 'user_id' });

      if (error) {
        console.error('Error saving chat history:', error);
      }
    } catch (error) {
      console.error('Unexpected error saving chat history:', error);
    }
  };

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

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      const payload: any = {
        message: inputText,
        context: messages.slice(-10).map(msg => ({
          role: msg.isUser ? 'user' : 'assistant',
          content: msg.text,
        })),
        clarification_state: clarificationState.active
          ? {
            active: true,
            partial_task: clarificationState.partialTask,
            original_message: clarificationState.originalMessage,
          }
          : undefined,
      };

      // Get the access token from the session for authenticated API calls
      const accessToken = session?.access_token;
      
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Chat API returned status ${response.status}`);
      }

      const data = await response.json();

      if (data.ready_to_create && data.task_created) {
        const formattedMessage = formatTaskCreatedMessage(data);
        const assistantMessage: Message = {
          id: Date.now() + 1,
          text: formattedMessage,
          isUser: false,
          timestamp: new Date(),
          type: 'task_created',
        };

        setMessages(prev => {
          const updated = [...prev, assistantMessage];
          saveChatHistory(updated);
          return updated;
        });

        setClarificationState({
          active: false,
          partialTask: null,
          originalMessage: '',
        });
      } else if (data.ready_to_create && !data.task_created) {
        const assistantMessage: Message = {
          id: Date.now() + 1,
          text: data.response || "I understood your task but couldn't save it. Please try again.",
          isUser: false,
          timestamp: new Date(),
          type: 'error',
        };

        setMessages(prev => {
          const updated = [...prev, assistantMessage];
          saveChatHistory(updated);
          return updated;
        });

        setClarificationState({
          active: false,
          partialTask: null,
          originalMessage: '',
        });
      } else if (data.needs_clarification) {
        const formattedMessage = formatClarificationRequest(data);
        const assistantMessage: Message = {
          id: Date.now() + 1,
          text: formattedMessage,
          isUser: false,
          timestamp: new Date(),
          type: 'needs_clarification',
        };

        setMessages(prev => {
          const updated = [...prev, assistantMessage];
          saveChatHistory(updated);
          return updated;
        });

        setClarificationState({
          active: true,
          partialTask: data.partial_task,
          originalMessage: inputText,
        });
      } else {
        const assistantMessage: Message = {
          id: Date.now() + 1,
          text: data.response || "I'm not sure how to respond to that.",
          isUser: false,
          timestamp: new Date(),
        };

        setMessages(prev => {
          const updated = [...prev, assistantMessage];
          saveChatHistory(updated);
          return updated;
        });

        setClarificationState({
          active: false,
          partialTask: null,
          originalMessage: '',
        });
      }
    } catch (error: any) {
      console.error('Error in chat interaction:', error);
      const errorMessage: Message = {
        id: Date.now() + 1,
        text: "Sorry, I ran into an error processing your request. Please try again.",
        isUser: false,
        timestamp: new Date(),
        type: 'error',
      };

      setMessages(prev => {
        const updated = [...prev, errorMessage];
        saveChatHistory(updated);
        return updated;
      });
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
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-gray-800">{children}</h3>,
          p: ({ children }) => <p className="text-sm text-gray-800 leading-relaxed mb-2">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1 text-sm text-gray-800">{children}</ul>,
          ol: ({ children }) => <ul className="list-decimal pl-5 mb-2 space-y-1 text-sm text-gray-800">{children}</ul>,
          li: ({ children }) => <li className="mb-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="px-1 py-0.5 rounded bg-gray-100 text-xs font-mono text-gray-800">
              {children}
            </code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  const clearChatHistory = async (): Promise<void> => {
    if (!session?.user?.id) return;

    try {
      const { error } = await supabase
        .from('user_chats')
        .update({ messages: [] })
        .eq('user_id', session.user.id);

      if (error) {
        console.error('Error clearing chat history:', error);
      }

      setMessages([getWelcomeMessage()]);
    } catch (error) {
      console.error('Unexpected error clearing chat history:', error);
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
            className="text-white hover:text-indigo-200 transition-colors"
            aria-label="Close chat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        {isLoadingHistory ? (
          <div className="h-full flex items-center justify-center flex-col gap-3 text-gray-500">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
            <p className="text-sm">Loading your chat history...</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${msg.isUser
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : msg.type === 'task_created'
                        ? 'bg-green-50 text-gray-900 border border-green-200 rounded-bl-none'
                        : msg.type === 'needs_clarification'
                          ? 'bg-yellow-50 text-gray-900 border border-yellow-200 rounded-bl-none'
                          : msg.type === 'error'
                            ? 'bg-red-50 text-gray-900 border border-red-200 rounded-bl-none'
                            : 'bg-white text-gray-900 border border-gray-200 rounded-bl-none'
                      }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center ${msg.isUser ? 'bg-indigo-700' : 'bg-gray-200'
                          }`}
                      >
                        {msg.isUser ? (
                          <User className="w-4 h-4 text-white" />
                        ) : (
                          <Bot className="w-4 h-4 text-gray-700" />
                        )}
                      </div>
                      <span className="text-[11px] text-gray-500">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      <MarkdownRenderer content={msg.text} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
            type="button"
            onClick={handleVoiceToggle}
            disabled={isLoading || isLoadingHistory || !session}
            className={`p-3 rounded-lg h-[42px] w-[42px] flex items-center justify-center self-end border ${isListening
              ? 'bg-red-100 border-red-400 text-red-600'
              : isSpeechSupported 
                ? 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              } transition-colors`}
            aria-label={isListening ? 'Stop listening' : isSpeechSupported ? 'Start voice input' : 'Voice not supported in this browser'}
            title={isSpeechSupported ? (isListening ? 'Stop listening' : 'Click to speak') : 'Voice input not supported in this browser. Try Chrome.'}
          >
            {isListening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            onClick={handleSendMessage}
            disabled={!inputText.trim() || isLoading || !session || isLoadingHistory}
            className="bg-indigo-600 text-white p-3 rounded-lg h-[42px] w-[42px] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors flex items-center justify-center self-end"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2 text-center">
          Pro tip: Ask me to "create a task" or "help plan my day"
        </p>
      </div>
    </div>
  );
};

export default ChatBot;
