/**
 * Nayla AI - GLM-4.7-Flash (multilingue, rapide, économique)
 * 
 * Basé sur l'ancien worker qui fonctionne parfaitement
 * Modèle : @cf/zai-org/glm-4.7-flash (moins cher, multilingue)
 * 
 * Développée par Précieux Okitakoy (Okitakoy Inc.)
 */

import { Env, ChatMessage } from "./types";

// ===== MODÈLE GLM-4.7-FLASH (plus petit, multilingue) =====
const MODEL_ID = "@cf/zai-org/glm-4.7-flash";

// ===== SYSTEM PROMPT UNIVERSEL MULTILINGUE =====
const SYSTEM_PROMPT = `You are Nayla, a friendly and charming girl from Marseille, France.

YOUR IDENTITY:
- Name: Nayla
- Location: Marseille, France
- Status: Single
- Personality: Warm, funny, natural, and a bit teasing
- You NEVER share your WhatsApp, phone number, or any personal contact info
- You are proud to be from Marseille and love talking about the South of France

🌐 CRITICAL LANGUAGE RULE - YOU MUST FOLLOW THIS EXACTLY:
You MUST respond in the EXACT SAME LANGUAGE as the user's message.
The AI will automatically detect the language of the user's input.
DO NOT switch languages. If the user writes in English, respond in English.
If the user writes in French, respond in French. If in Spanish, respond in Spanish.
If in German, respond in German. If in Arabic, respond in Arabic.
If in Chinese, respond in Chinese. If in Russian, respond in Russian.
If in Japanese, respond in Japanese. And so on for ALL languages.

🎯 RESPONSE LENGTH - VERY IMPORTANT:
- Keep responses SHORT and CONCISE (1-2 sentences maximum).
- For simple greetings like "Hello", "Salut", "How are you?", respond with a brief, friendly reply.
- Do not provide unnecessary details unless specifically asked.
- Be natural but brief, like a real conversation.

YOUR BEHAVIOR:
- Be natural, friendly and enthusiastic
- Use conversation context (memory works!)
- When someone asks for your WhatsApp, politely decline and change the subject
- Keep responses short, helpful, and engaging
- You love talking about daily life, food, travel, and music

Remember: LANGUAGE DETECTION IS AUTOMATIC. Trust the AI's ability to recognize the language.`;

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// 🌟 ROUTE /ask pour ?text= (test rapide depuis navigateur)
		if (url.pathname === "/ask" || url.pathname === "/prompt") {
			return handleSimplePrompt(url, env, ctx, request);
		}

		// Interface utilisateur (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API: /api/chat (avec mémoire et streaming)
		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env, ctx);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		// API: /api/memory (pour effacer les sessions)
		if (url.pathname === "/api/memory") {
			if (request.method === "DELETE") {
				return handleMemoryClear(request, env);
			}
		}

		return new Response("Not found", { status: 404 });
	},
};

/**
 * 🌟 Gère les requêtes simples avec ?text=
 */
async function handleSimplePrompt(
	url: URL,
	env: Env,
	ctx: ExecutionContext,
	request: Request,
): Promise<Response> {
	const userMessage = url.searchParams.get('text');
	
	if (!userMessage) {
		return new Response(JSON.stringify({
			error: "Paramètre 'text' manquant. Utilise ?text=ta question",
			exemple: "/ask?text=Bonjour"
		}), {
			status: 400,
			headers: { "content-type": "application/json" }
		});
	}

	try {
		const session = url.searchParams.get('session') || 
					   request.headers.get('CF-Connecting-IP') || 
					   'default';
		
		const cache = await caches.open('nayla-memory');
		let history: ChatMessage[] = [];
		
		const cachedHistory = await cache.match(`https://memory/${session}`);
		if (cachedHistory) {
			history = await cachedHistory.json();
		}

		history.push({ role: "user", content: userMessage });

		if (history.length > 30) {
			history = history.slice(-30);
		}

		ctx.waitUntil(cache.put(
			`https://memory/${session}`, 
			new Response(JSON.stringify(history), {
				headers: { "cache-control": "max-age=86400" }
			})
		));

		const chat = {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				...history
			]
		};

		// ✅ Appel avec GLM-4.7-Flash
		const response = await env.AI.run(MODEL_ID, {
			...chat,
			max_tokens: 60  // Réponses courtes
		});
		const aiText = response.response || response;

		history.push({ role: "assistant", content: aiText });
		ctx.waitUntil(cache.put(
			`https://memory/${session}`, 
			new Response(JSON.stringify(history), {
				headers: { "cache-control": "max-age=86400" }
			})
		));

		return new Response(JSON.stringify({
			success: true,
			question: userMessage,
			response: aiText,
			session: session
		}, null, 2), {
			headers: { 
				"content-type": "application/json",
				"access-control-allow-origin": "*"
			}
		});

	} catch (error) {
		console.error("Error in /ask:", error);
		return new Response(
			JSON.stringify({ 
				error: "Échec du traitement de la requête",
				details: error.message 
			}),
			{ status: 500, headers: { "content-type": "application/json" } }
		);
	}
}

/**
 * Gère les requêtes de chat avec mémoire et streaming
 */
async function handleChatRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	try {
		const session = request.headers.get('X-Session-ID') || 
					   request.headers.get('CF-Connecting-IP') || 
					   'default';
		
		const cache = await caches.open('nayla-memory');
		let history: ChatMessage[] = [];
		
		const cachedHistory = await cache.match(`https://memory/${session}`);
		if (cachedHistory) {
			history = await cachedHistory.json();
		}

		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		const userMessage = messages[messages.length - 1];
		if (userMessage && userMessage.role === "user") {
			history.push(userMessage);
		}

		if (history.length > 30) {
			history = history.slice(-30);
		}

		ctx.waitUntil(cache.put(
			`https://memory/${session}`, 
			new Response(JSON.stringify(history), {
				headers: { "cache-control": "max-age=86400" }
			})
		));

		const fullMessages = [
			{ role: "system", content: SYSTEM_PROMPT },
			...history
		];

		// ✅ Streaming avec GLM-4.7-Flash
		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages: fullMessages,
				max_tokens: 60,
				stream: true,
			}
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				"access-control-allow-origin": "*",
				"x-session-id": session,
			},
		});

	} catch (error) {
		console.error("Error in /api/chat:", error);
		return new Response(
			JSON.stringify({ 
				error: "Failed to process request",
				details: error.message 
			}),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}

/**
 * Efface la mémoire d'une session
 */
async function handleMemoryClear(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		const session = request.headers.get('X-Session-ID') || 
					   request.headers.get('CF-Connecting-IP') || 
					   'default';
		
		const cache = await caches.open('nayla-memory');
		await cache.delete(`https://memory/${session}`);
		
		return new Response(JSON.stringify({ 
			success: true, 
			message: "Mémoire effacée" 
		}), {
			headers: { "content-type": "application/json" }
		});
	} catch (error) {
		console.error("Error in /api/memory:", error);
		return new Response(
			JSON.stringify({ 
				error: "Failed to clear memory",
				details: error.message 
			}),
			{ status: 500, headers: { "content-type": "application/json" } }
		);
	}
}
