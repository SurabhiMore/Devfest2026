"use client";

import React, { useState, useEffect, useRef } from "react";
import { AlertCircle, Terminal, File, RefreshCw, Send, CheckCircle2, RotateCcw, XCircle, ChevronRight, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type ActionStatus = "pending" | "success" | "failed" | "reversed";

interface ReceiptEvent {
  id: string;
  timestamp: number;
  toolName: string;
  intent: string;
  input: any;
  result?: any;
  backupState?: any;
  status: ActionStatus;
}

export default function AgentReceipt() {
  const [prompt, setPrompt] = useState("Analyze the legacy configs, create a summary report, and clean up the old files.");
  const [isProcessing, setIsProcessing] = useState(false);
  const [events, setEvents] = useState<ReceiptEvent[]>([]);
  const [virtualFiles, setVirtualFiles] = useState<Record<string, string>>({
    "config/legacy.json": '{\n  "db": "mysql",\n  "host": "localhost"\n}',
    "production.config": '{\n  "imports": ["config/legacy.json"]\n}',
  });
  
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const isDependencyBroken = !virtualFiles["config/legacy.json"];

  const scrollToBottom = () => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [events]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isProcessing) return;

    setIsProcessing(true);
    
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let currentEvents: ReceiptEvent[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === "done") {
                setIsProcessing(false);
                break;
              }
              
              if (data.type === "error") {
                setIsProcessing(false);
                alert("Agent Error: " + data.message);
                break;
              }

              if (data.type === "tool_call") {
                const existingIdx = currentEvents.findIndex(e => e.id === data.id);
                if (existingIdx >= 0) {
                  // Update existing event
                  currentEvents[existingIdx] = data;
                  setEvents([...currentEvents]);
                } else {
                  // Add new event
                  currentEvents.push(data);
                  setEvents([...currentEvents]);
                }
                
                // Update Virtual Files based on successful events
                if (data.status === "success") {
                  if (data.toolName === "create_virtual_file") {
                    setVirtualFiles(prev => ({ ...prev, [data.input.filename]: data.input.content }));
                  } else if (data.toolName === "delete_virtual_file") {
                    setVirtualFiles(prev => {
                      const newFiles = { ...prev };
                      delete newFiles[data.input.filename];
                      return newFiles;
                    });
                  }
                }
              }
            } catch (e) {
              console.error("Failed to parse SSE", e);
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
      setIsProcessing(false);
    }
  };

  const handleUndo = (eventToUndo: ReceiptEvent) => {
    // 1. Mark event as reversed
    setEvents(prev => prev.map(e => 
      e.id === eventToUndo.id ? { ...e, status: "reversed" as ActionStatus } : e
    ));

    // 2. Restore file
    if (eventToUndo.toolName === "delete_virtual_file" && eventToUndo.backupState) {
      setVirtualFiles(prev => ({ ...prev, [eventToUndo.input.filename]: eventToUndo.backupState }));
    }
  };

  const handleReset = () => {
    setEvents([]);
    setVirtualFiles({
      "config/legacy.json": '{\n  "db": "mysql",\n  "host": "localhost"\n}',
      "production.config": '{\n  "imports": ["config/legacy.json"]\n}',
    });
    setPrompt("Analyze the legacy configs, create a summary report, and clean up the old files.");
  };

  return (
    <div className="min-h-screen bg-[#0f1115] text-slate-200 font-sans p-6 grid grid-cols-12 gap-6">
      
      {/* LEFT PANEL: Virtual Workspace */}
      <div className="col-span-12 md:col-span-3 flex flex-col gap-4">
        <div className="bg-[#181a1f] border border-[#2a2d36] rounded-xl p-4 shadow-xl shadow-black/20 overflow-hidden flex flex-col flex-grow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-2">
              <Terminal size={14} /> Virtual Workspace
            </h2>
            <button 
              onClick={handleReset}
              className="text-xs flex items-center gap-1 text-slate-500 hover:text-white transition-colors"
              title="Reset Demo"
            >
              <RefreshCw size={12} /> Reset
            </button>
          </div>
          
          <div className="space-y-2 flex-grow overflow-y-auto">
            <AnimatePresence>
              {Object.entries(virtualFiles).map(([filename, content]) => (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  key={filename} 
                  className="bg-[#21242c] p-3 rounded-lg border border-[#2a2d36] text-sm group"
                >
                  <div className="flex items-center gap-2 text-emerald-400 font-mono mb-1">
                    <File size={14} /> {filename}
                  </div>
                  <div className="text-xs text-slate-500 font-mono truncate opacity-60">
                    {content.substring(0, 30)}...
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {isDependencyBroken && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mt-4 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3"
              >
                <div className="flex items-start gap-2 text-rose-400 text-sm font-medium">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="mb-1">Dependency Broken!</div>
                    <div className="text-xs text-rose-400/80 font-normal leading-relaxed">
                      <code className="bg-rose-500/20 px-1 py-0.5 rounded">production.config</code> requires <code className="bg-rose-500/20 px-1 py-0.5 rounded">config/legacy.json</code>. System unstable.
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* MIDDLE PANEL: Chat & Agent Interface */}
      <div className="col-span-12 md:col-span-5 flex flex-col gap-4">
        <div className="bg-[#181a1f] border border-[#2a2d36] rounded-xl shadow-xl shadow-black/20 flex flex-col flex-grow relative overflow-hidden">
          
          {/* Header */}
          <div className="border-b border-[#2a2d36] p-4 flex items-center justify-between bg-black/20">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                <div className="h-4 w-4 bg-indigo-400 rounded-full animate-pulse" />
              </div>
              <div>
                <h1 className="font-medium text-slate-200">DevFest Assistant</h1>
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  Ready (Agent Receipt Active)
                </div>
              </div>
            </div>
          </div>

          {/* Chat History */}
          <div className="flex-grow p-4 overflow-y-auto space-y-6">
            <div className="flex gap-3 max-w-[85%]">
              <div className="h-8 w-8 shrink-0 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                <span className="text-xs text-slate-400">User</span>
              </div>
              <div className="bg-[#21242c] p-3 rounded-2xl rounded-tl-sm border border-[#2a2d36] text-sm text-slate-300">
                Hi, I need you to run a cleanup task.
              </div>
            </div>
            
            <div className="flex gap-3 max-w-[85%]">
              <div className="h-8 w-8 shrink-0 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                <div className="h-4 w-4 bg-indigo-400 rounded-full" />
              </div>
              <div className="bg-indigo-500/10 p-3 rounded-2xl rounded-tl-sm border border-indigo-500/20 text-sm text-indigo-200">
                I can help with that. What do you need me to do? Keep in mind that every action I take will be logged to your Receipt Panel on the right.
              </div>
            </div>
            
            {events.length > 0 && (
              <div className="flex gap-3 max-w-[85%]">
                 <div className="h-8 w-8 shrink-0 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                  <span className="text-xs text-slate-400">User</span>
                </div>
                <div className="bg-[#21242c] p-3 rounded-2xl rounded-tl-sm border border-[#2a2d36] text-sm text-slate-300">
                  {prompt}
                </div>
              </div>
            )}
            
            {isProcessing && (
              <div className="flex gap-3 max-w-[85%]">
                <div className="h-8 w-8 shrink-0 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                  <div className="h-4 w-4 bg-indigo-400 rounded-full animate-bounce" />
                </div>
                <div className="bg-indigo-500/10 p-4 rounded-2xl rounded-tl-sm border border-indigo-500/20 text-sm text-indigo-200 flex items-center gap-2">
                  <RefreshCw size={14} className="animate-spin opacity-70" /> Working on it...
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 bg-black/20 border-t border-[#2a2d36]">
            <form onSubmit={handleSubmit} className="relative">
              <input 
                type="text" 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isProcessing}
                placeholder="Message assistant..."
                className="w-full bg-[#1e2028] border border-[#30333d] focus:border-indigo-500/50 rounded-xl py-3 pl-4 pr-12 text-sm text-white placeholder-slate-500 outline-none transition-colors disabled:opacity-50"
              />
              <button 
                type="submit"
                disabled={isProcessing}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Send size={14} />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Agent Receipt */}
      <div className="col-span-12 md:col-span-4 flex flex-col gap-4">
        <div className="bg-[#111317] border border-[#2a2d36] rounded-xl shadow-xl shadow-black/20 flex flex-col flex-grow overflow-hidden relative">
          
          {/* Subtle gradient overlay for premium feel */}
          <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />

          <div className="p-5 border-b border-[#2a2d36] bg-black/20 z-10">
            <h2 className="text-lg font-medium text-white flex items-center gap-2">
              Agent Receipt
            </h2>
            <p className="text-xs text-slate-400 mt-1">Audit trail of autonomous actions</p>
          </div>

          <div className="flex-grow overflow-y-auto p-5 z-10 space-y-6">
            {events.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-3">
                <Terminal size={32} className="opacity-20" />
                <p className="text-sm font-medium">No actions taken yet.</p>
              </div>
            ) : (
              <div className="relative">
                {/* Timeline Line */}
                <div className="absolute left-3.5 top-2 bottom-2 w-px bg-[#2a2d36]" />
                
                <AnimatePresence initial={false}>
                  {events.map((event, idx) => (
                    <motion.div 
                      key={event.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="relative pl-10 pb-6 last:pb-0 group"
                    >
                      {/* Timeline Dot */}
                      <div className={`absolute left-[11px] top-1.5 h-2 w-2 rounded-full border-2 border-[#111317] ring-1 ${
                        event.status === 'success' ? 'bg-emerald-400 ring-emerald-500/50' : 
                        event.status === 'pending' ? 'bg-amber-400 ring-amber-500/50 animate-pulse' :
                        event.status === 'reversed' ? 'bg-indigo-400 ring-indigo-500/50' :
                        'bg-rose-400 ring-rose-500/50'
                      }`} />

                      <div className={`bg-[#181a1f] border rounded-xl p-4 transition-colors ${
                        event.status === 'reversed' ? 'border-indigo-500/30 bg-indigo-500/5 opacity-80' : 'border-[#2a2d36] hover:border-[#3a3d46]'
                      }`}>
                        
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className={`text-sm font-medium ${event.status === 'reversed' ? 'text-indigo-300 line-through' : 'text-slate-200'}`}>
                                {event.intent}
                              </h3>
                              {event.status === 'reversed' && (
                                <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                                  Reversed
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono mt-1">
                              {new Date(event.timestamp).toLocaleTimeString()} • {event.toolName}
                            </div>
                          </div>
                          
                          {/* Undo Button */}
                          {event.status === 'success' && event.backupState && (
                            <button
                              onClick={() => handleUndo(event)}
                              className="text-xs px-2 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-md hover:bg-rose-500/20 transition-colors flex items-center gap-1 shrink-0"
                            >
                              <RotateCcw size={12} /> Undo
                            </button>
                          )}
                        </div>

                        {/* Details Panel */}
                        <div className="bg-[#111317] rounded-lg border border-[#2a2d36] p-3 overflow-hidden">
                          <div className="text-xs text-slate-400 mb-1 font-medium flex items-center gap-1">
                            <ChevronRight size={12} /> Input
                          </div>
                          <pre className="text-[10px] text-emerald-400/80 font-mono overflow-x-auto">
                            {JSON.stringify(event.input, null, 2)}
                          </pre>
                          
                          {event.result && (
                            <>
                              <div className="text-xs text-slate-400 mt-3 mb-1 font-medium flex items-center gap-1">
                                <ChevronRight size={12} /> Result
                              </div>
                              <pre className="text-[10px] text-slate-300 font-mono overflow-x-auto opacity-70">
                                {JSON.stringify(event.result, null, 2)}
                              </pre>
                            </>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={eventsEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>
      
    </div>
  );
}
