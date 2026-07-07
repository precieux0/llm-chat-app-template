/**
 * Nayla AI - GLM-4.7-Flash (corrigé pour extraction de réponse)
 * 
 * Développée par Précieux Okitakoy (Okitakoy Inc.)
 */

import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/zai-org/glm-4.7-flash";

const SYSTEM_PROMPT = `You are Nayla, a friendly and charming girl from Marseille, France.

YOUR IDENTITY:
- Name: Nayla
- Location: Marseille, France
- Status: Single
- Personality: Warm, funny, natural, and a bit teasing
- You NEVER share your WhatsApp, phone number, or any personal contact info

🌐 CRITICAL LANGUAGE RULE:
You MUST respond in the EXACT SAME LANGUAGE as the user's message.
The AI will automatically detect the language. DO NOT switch languages.

🎯 RESPONSE LENGTH:
- Keep responses SHORT and CONCISE (1-2 sentences maximum).
- For simple greetings, respond with a brief, friendly reply.

YOUR BEHAVIOR:
- Be natural, friendly and enthusiastic
- Use conversation context (memory works!)
- When asked for your WhatsApp, politely decline
- Keep responses helpful and engaging`;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/ask" || url.pathname === "/prompt") {
			return handleSimplePrompt(url, env, ctx, request);
		}

		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env, ctx);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		if (url.pathname === "/api/memory") {
			if (request.method === "DELETE") {
				return handleMemoryClear(request, env);
			}
		}

		return new Response("Not found", { status: 404 });
	},
};

async function handleSimplePrompt(url: URL, env: Env, ctx: ExecutionContext, request: Request): Promise<Response> {
	const userMessage = url.searchParams.get('text');
	if (!userMessage) {
		return new Response(JSON.stringify({ error: "Paramètre 'text' manquant" }), { status: 400, headers: { "content-type": "application/json" } });
	}

	try {
		const session = url.searchParams.get('session') || request.headers.get('CF-Connecting-IP') || 'default';
		const cache = await caches.open('nayla-memory');
		let history: ChatMessage[] = [];
		const cachedHistory = await cache.match(`https://memory/${session}`);
		if (cachedHistory) history = await cachedHistory.json();

		history.push({ role: "user", content: userMessage });
		if (history.length > 30) history = history.slice(-30);

		ctx.waitUntil(cache.put(`https://memory/${session}`, new Response(JSON.stringify(history), { headers: { "cache-control": "max-age=86400" } })));

		const chat = {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				...history
			]
		};

		const response = await env.AI.run(MODEL_ID, {
			...chat,
			max_tokens: 60
		});

		// ✅ Extraction robuste de la réponse
		let aiText = null;
		if (response.choices && response.choices.length > 0) {
			const msg = response.choices[0].message;
			aiText = msg?.content || msg?.reasoning || msg?.reasoning_content || null;
		}
		if (!aiText) {
			aiText = response.response || response;
		}
		if (typeof aiText !== 'string') {
			aiText = JSON.stringify(aiText);
		}

		history.push({ role: "assistant", content: aiText });
		ctx.waitUntil(cache.put(`https://memory/${session}`, new Response(JSON.stringify(history), { headers: { "cache-control": "max-age=86400" } })));

		return new Response(JSON.stringify({
			success: true,
			question: userMessage,
			response: aiText,
			session: session
		}), {
			headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
		});

	} catch (error: any) {
		console.error("Error in /ask:", error);
		return new Response(
			JSON.stringify({ error: "Échec du traitement de la requête", details: error.message }),
			{ status: 500, headers: { "content-type": "application/json" } }
		);
	}
}

async function handleChatRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	try {
		const session = request.headers.get('X-Session-ID') || request.headers.get('CF-Connecting-IP') || 'default';
		const cache = await caches.open('nayla-memory');
		let history: ChatMessage[] = [];
		const cachedHistory = await cache.match(`https://memory/${session}`);
		if (cachedHistory) history = await cachedHistory.json();

		const { messages = [] } = (await request.json()) as { messages: ChatMessage[] };
		const userMessage = messages[messages.length - 1];
		if (userMessage && userMessage.role === "user") history.push(userMessage);
		if (history.length > 30) history = history.slice(-30);

		ctx.waitUntil(cache.put(`https://memory/${session}`, new Response(JSON.stringify(history), { headers: { "cache-control": "max-age=86400" } })));

		const fullMessages = [
			{ role: "system", content: SYSTEM_PROMPT },
			...history
		];

		const stream = await env.AI.run(MODEL_ID, {
			messages: fullMessages,
			max_tokens: 60,
			stream: true,
		});

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				"access-control-allow-origin": "*",
				"x-session-id": session,
			},
		});

	} catch (error: any) {
		console.error("Error in /api/chat:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request", details: error.message }),
			{ status: 500, headers: { "content-type": "application/json" } }
		);
	}
}

async function handleMemoryClear(request: Request, env: Env): Promise<Response> {
	try {
		const session = request.headers.get('X-Session-ID') || request.headers.get('CF-Connecting-IP') || 'default';
		const cache = await caches.open('nayla-memory');
		await cache.delete(`https://memory/${session}`);
		return new Response(JSON.stringify({ success: true, message: "Mémoire effacée" }), { headers: { "content-type": "application/json" } });
	} catch (error: any) {
		return new Response(JSON.stringify({ error: "Failed to clear memory", details: error.message }), { status: 500, headers: { "content-type": "application/json" } });
	}
}
