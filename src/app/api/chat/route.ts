import { Configuration, OpenAIApi } from 'openai-edge';
//this can help streamming effect on front end
import { OpenAIStream, StreamingTextResponse, Message } from 'ai';
import { getContext } from '@/lib/context';
import { db } from '@/lib/db';
import { chats, messages as messagesDB } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getEmbedding } from '@/lib/embeddings';

//connect to openai api when chatting
export const runtime = 'edge';

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(config);

export async function POST(req: Request) {
  try {
    const { messages, chatId } = await req.json();
    const _chats = await db.select().from(chats).where(eq(chats.id, chatId));
    if (_chats.length != 1) {
      return NextResponse.json({ error: 'chat not found' }, { status: 404 });
    }
    const fileKey = _chats[0].fileKey;

    const lastMessage = messages[messages.length - 1].content;
    const { text } = await getContext(lastMessage, fileKey);
    const prompt = {
      role: 'system',
      content: `
      START CONTEXT BLOCK
      ${text}
      END OF CONTEXT BLOCK
      AI assistant will take into account any CONTEXT BLOCK that is provided in a conversation.
      AI assistant must anwser the question in user's question language.
      If the context does not provide the answer to question, the AI assistant will say it doesn't know.
      AI assistant will not apologize for previous responses, but instead will indicated new information was gained.
      AI assistant will not invent anything that is not drawn directly from the context.`,
    };
    const userMessage = messages.filter(
      (message: Message) => message.role === 'user'
    );
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [prompt, userMessage[userMessage.length - 1]],
      //stream will generate reponse one by one word
      stream: true,
    });
    const stream = OpenAIStream(response, {
      onStart: async () => {
        //save user message
        await db.insert(messagesDB).values({
          chatId,
          content: lastMessage,
          role: 'user',
        });
      },
      onCompletion: async (completion) => {
        //save bot's message
        await db.insert(messagesDB).values({
          chatId,
          content: completion,
          role: 'system',
        });
      },
    });
    return new StreamingTextResponse(stream);
  } catch (error) {
    console.error(error);
  }
}
