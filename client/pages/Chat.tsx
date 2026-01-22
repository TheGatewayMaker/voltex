import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";

interface Message {
  id: string;
  text: string;
  sender: "user" | "other";
  timestamp: string;
}

// Mock messages - in real app this would come from API/state
const MOCK_MESSAGES: Record<string, Message[]> = {
  "1": [
    {
      id: "1",
      text: "Hey! How are you?",
      sender: "other",
      timestamp: "2:30 PM",
    },
    {
      id: "2",
      text: "I'm doing great! Just finished the project.",
      sender: "user",
      timestamp: "2:32 PM",
    },
    {
      id: "3",
      text: "That's awesome! Can't wait to see it.",
      sender: "other",
      timestamp: "2:33 PM",
    },
    {
      id: "4",
      text: "I'll send you the details tomorrow",
      sender: "user",
      timestamp: "2:35 PM",
    },
    {
      id: "5",
      text: "Thanks! See you tomorrow 😊",
      sender: "other",
      timestamp: "2:45 PM",
    },
  ],
  "2": [
    {
      id: "1",
      text: "Hey, can you review the document?",
      sender: "other",
      timestamp: "1:30 PM",
    },
    {
      id: "2",
      text: "Sure, I'll check it out now",
      sender: "user",
      timestamp: "1:32 PM",
    },
  ],
};

const CONVERSATION_NAMES: Record<string, string> = {
  "1": "Sarah Johnson",
  "2": "Alex Chen",
  "3": "Team Project",
  "4": "Emma Wilson",
  "5": "David Park",
  "6": "Lisa Brown",
};

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>(
    MOCK_MESSAGES[id || "1"] || [],
  );
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const conversationName = CONVERSATION_NAMES[id || "1"] || "Chat";

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: String(messages.length + 1),
      text: inputValue,
      sender: "user",
      timestamp: new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
    };

    setMessages([...messages, newMessage]);
    setInputValue("");
  };

  const handleBackClick = () => {
    navigate("/");
  };

  return (
    <Layout
      showBack={true}
      title={conversationName}
      onBackClick={handleBackClick}
    >
      <div className="flex flex-col h-full bg-background">
        {/* Messages Container */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6 space-y-3 md:space-y-4"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`flex flex-col max-w-xs md:max-w-md lg:max-w-lg ${
                  message.sender === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`px-4 py-2 md:px-5 md:py-3 rounded-2xl ${
                    message.sender === "user"
                      ? "bg-primary text-white rounded-br-none"
                      : "bg-secondary text-foreground rounded-bl-none"
                  }`}
                >
                  <p className="text-sm md:text-base break-words">
                    {message.text}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground mt-1 px-2">
                  {message.timestamp}
                </span>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input */}
        <div className="border-t border-border bg-card px-4 py-3 md:px-6 md:py-4 flex-shrink-0">
          <div className="flex items-end gap-3 md:gap-4">
            <button className="p-2 hover:bg-secondary rounded-lg transition-colors flex-shrink-0">
              <svg
                className="w-5 h-5 md:w-6 md:h-6 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>

            <div className="flex-1 relative">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Type a message..."
                className="w-full px-4 py-2 md:py-3 bg-secondary text-foreground placeholder-muted-foreground rounded-full border-0 focus:ring-2 focus:ring-primary outline-none transition-all text-sm md:text-base"
              />
            </div>

            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim()}
              className="p-2 hover:bg-secondary rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <svg
                className="w-5 h-5 md:w-6 md:h-6 text-primary"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.8429026 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.9702544,11.6889879 L4.13399899,1.16134159 C3.34915502,0.9042441 2.40734225,1.01539954 1.77946707,1.4866916 C0.994623095,2.11800827 0.837654326,3.20771222 1.15159189,3.99320908 L3.03521743,10.4341721 C3.03521743,10.5912695 3.19218622,10.7483669 3.50612381,10.7483669 L16.6915026,11.5338539 C16.6915026,11.5338539 17.1624089,11.5338539 17.1624089,12.0051459 C17.1624089,12.4744748 16.6915026,12.4744748 16.6915026,12.4744748 Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
