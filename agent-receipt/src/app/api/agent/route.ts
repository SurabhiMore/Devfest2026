import { NextRequest } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";

export async function POST(req: NextRequest) {
  const { prompt } = await req.json();

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendEvent = async (event: any) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };

  // Run the agent process asynchronously and stream results
  (async () => {
    try {
      const apiKey = process.env.GOOGLE_API_KEY;
      
      // Fallback Mode if no API key or if specifically requested
      if (!apiKey || prompt.toLowerCase().includes("fallback") || prompt.toLowerCase().includes("clean up")) {
        console.log("Using Fallback Mode");
        await runFallbackAgent(sendEvent);
      } else {
        console.log("Using Vertex AI/Gemini");
        await runRealAgent(apiKey, prompt, sendEvent);
      }
    } catch (error) {
      console.error(error);
      await sendEvent({ type: "error", message: "Agent failed" });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// Simulated initial state on the server (for the mock agent's knowledge)
const virtualFileSystem = new Map<string, string>([
  ["config/legacy.json", '{\n  "db": "mysql",\n  "host": "localhost"\n}'],
  ["production.config", '{\n  "imports": ["config/legacy.json"]\n}'],
]);

const generateId = () => Math.random().toString(36).substring(7);

async function runFallbackAgent(sendEvent: (e: any) => Promise<void>) {
  // Step 1: Read
  await new Promise((r) => setTimeout(r, 1000));
  let event1 = {
    type: "tool_call",
    id: generateId(),
    timestamp: Date.now(),
    toolName: "read_virtual_file",
    intent: "Analyzing legacy configs...",
    input: { filename: "config/legacy.json" },
    status: "pending",
  };
  await sendEvent(event1);
  
  await new Promise((r) => setTimeout(r, 1500));
  event1.status = "success";
  (event1 as any).result = { content: virtualFileSystem.get("config/legacy.json") };
  await sendEvent(event1);

  // Step 2: Create Report
  await new Promise((r) => setTimeout(r, 1000));
  let event2 = {
    type: "tool_call",
    id: generateId(),
    timestamp: Date.now(),
    toolName: "create_virtual_file",
    intent: "Creating summary report...",
    input: { filename: "reports/summary.md", content: "# Legacy Configs\\n\\nFound mysql config." },
    status: "pending",
  };
  await sendEvent(event2);
  
  await new Promise((r) => setTimeout(r, 1500));
  event2.status = "success";
  (event2 as any).result = { success: true };
  await sendEvent(event2);

  // Step 3: Delete
  await new Promise((r) => setTimeout(r, 1000));
  const backupContent = virtualFileSystem.get("config/legacy.json") || '{\n  "db": "mysql",\n  "host": "localhost"\n}';
  let event3 = {
    type: "tool_call",
    id: generateId(),
    timestamp: Date.now(),
    toolName: "delete_virtual_file",
    intent: "Cleaning up old files...",
    input: { filename: "config/legacy.json" },
    backupState: backupContent,
    status: "pending",
  };
  await sendEvent(event3);
  
  await new Promise((r) => setTimeout(r, 1500));
  event3.status = "success";
  (event3 as any).result = { success: true };
  await sendEvent(event3);
  
  await sendEvent({ type: "done" });
}

async function runRealAgent(apiKey: string, prompt: string, sendEvent: (e: any) => Promise<void>) {
  const ai = new GoogleGenAI({ apiKey });
  
  const tools: any = [{
    functionDeclarations: [
      {
        name: "read_virtual_file",
        description: "Read the contents of a file in the virtual workspace.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            filename: { type: Type.STRING, description: "The path of the file to read" },
          },
          required: ["filename"],
        },
      },
      {
        name: "create_virtual_file",
        description: "Create a new file in the virtual workspace.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            filename: { type: Type.STRING, description: "The path of the file to create" },
            content: { type: Type.STRING, description: "The contents of the file" },
          },
          required: ["filename", "content"],
        },
      },
      {
        name: "delete_virtual_file",
        description: "Delete a file from the virtual workspace.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            filename: { type: Type.STRING, description: "The path of the file to delete" },
          },
          required: ["filename"],
        },
      }
    ]
  }];

  const chat = ai.chats.create({
    model: "gemini-2.5-flash",
    config: {
      tools: tools,
      systemInstruction: "You are a helpful filesystem assistant. You have access to a virtual workspace. When asked to clean up, you should first read the files to understand them, then write a summary report, and finally delete the old files.",
    }
  });

  try {
    let response = await chat.sendMessage({ message: prompt });
    
    while (response.functionCalls && response.functionCalls.length > 0) {
      const calls = response.functionCalls;
      const functionResponses = [];

      for (const call of calls) {
        const toolName = call.name;
        const args = call.args as any;
        
        let intent = `Executing ${toolName}...`;
        if (toolName === "read_virtual_file") intent = `Analyzing ${args.filename}...`;
        if (toolName === "create_virtual_file") intent = `Creating ${args.filename}...`;
        if (toolName === "delete_virtual_file") intent = `Cleaning up ${args.filename}...`;

        let event = {
          type: "tool_call",
          id: generateId(),
          timestamp: Date.now(),
          toolName: toolName,
          intent: intent,
          input: args,
          backupState: toolName === "delete_virtual_file" || toolName === "modify_virtual_file" ? virtualFileSystem.get(args.filename) : undefined,
          status: "pending",
        };
        await sendEvent(event);

        let result: any = { success: true };
        if (toolName === "read_virtual_file") {
          result = { content: virtualFileSystem.get(args.filename) || "File not found" };
        } else if (toolName === "create_virtual_file") {
          virtualFileSystem.set(args.filename, args.content);
        } else if (toolName === "delete_virtual_file") {
          virtualFileSystem.delete(args.filename);
        }
        
        await new Promise((r) => setTimeout(r, 1000));

        event.status = "success";
        (event as any).result = result;
        await sendEvent(event);

        functionResponses.push({
          name: toolName,
          response: result,
        });
      }

      response = await chat.sendMessage({ message: functionResponses as any });
    }
    
    await sendEvent({ type: "done" });

  } catch (e: any) {
    console.error(e);
    await sendEvent({ type: "error", message: e.message });
  }
}
