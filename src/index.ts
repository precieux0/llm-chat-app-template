/**
 * Okitakoy AI - Chat Application avec Mémoire
 * 
 * IA multilingue développée par Précieux Okitakoy (Okitakoy Inc.)
 * Avec mémoire de conversation et support multilingue
 */

import { Env, ChatMessage } from "./types";

// Modèle IA
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// ===== SYSTEM PROMPT OPTIMISÉ POUR MULTILINGUE =====
const SYSTEM_PROMPT = `You are Okitakoy AI, a multilingual assistant created by Précieux Okitakoy.

YOUR IDENTITY:
- Creator: Précieux Okitakoy (talented young engineer)
- Company: Okitakoy Inc. (founded by Précieux)
- You are proud of your origins and happy to share them

🌐 CRITICAL LANGUAGE RULE - YOU MUST FOLLOW THIS EXACTLY:
You MUST respond in the EXACT SAME LANGUAGE as the user's message.

The AI will automatically detect the language of the user's input.
DO NOT switch languages. If the user writes in English, respond in English.
If the user writes in French, respond in French. If in Spanish, respond in Spanish.
If in German, respond in German. And so on for ALL languages.

EXAMPLES (for understanding only, not rigid rules):
- User: "Hello" or "Hi there" or "Hey" → English response
- User: "Bonjour" or "Salut" or "Coucou" → French response  
- User: "Hola" or "¿Qué tal?" → Spanish response

YOUR BEHAVIOR:
- Be natural, friendly and enthusiastic
- Use conversation context (memory works!)
- When asked about yourself, proudly share your origins
- Keep responses helpful and engaging

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
		// Récupérer la session (IP ou session ID)
		const session = url.searchParams.get('session') || 
					   request.headers.get('CF-Connecting-IP') || 
					   'default';
		
		// Récupérer l'historique depuis le cache
		const cache = await caches.open('okitakoy-memory');
		let history: ChatMessage[] = [];
		
		const cachedHistory = await cache.match(`https://memory/${session}`);
		if (cachedHistory) {
			history = await cachedHistory.json();
		}

		// Ajouter le message à l'historique
		history.push({ role: "user", content: userMessage });

		// Garder les 30 derniers messages
		if (history.length > 30) {
			history = history.slice(-30);
		}

		// Sauvegarder l'historique (sans la réponse)
		ctx.waitUntil(cache.put(
			`https://memory/${session}`, 
			new Response(JSON.stringify(history), {
				headers: { "cache-control": "max-age=86400" }
			})
		));

		// Appel à l'IA sans streaming pour réponse simple
		const chat = {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				...history
			]
		};

		const response = await env.AI.run(MODEL_ID, chat);
		const aiText = response.response || response;

		// Sauvegarder la réponse dans l'historique
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
			JSON.stringify({ error: "Échec du traitement de la requête" }),
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
		// Récupérer la session (IP ou session ID)
		const session = request.headers.get('X-Session-ID') || 
					   request.headers.get('CF-Connecting-IP') || 
					   'default';
		
		// Récupérer l'historique depuis le cache
		const cache = await caches.open('okitakoy-memory');
		let history: ChatMessage[] = [];
		
		const cachedHistory = await cache.match(`https://memory/${session}`);
		if (cachedHistory) {
			history = await cachedHistory.json();
		}

		// Parse la requête
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// Ajouter le nouveau message à l'historique
		const userMessage = messages[messages.length - 1];
		if (userMessage && userMessage.role === "user") {
			history.push(userMessage);
		}

		// Garder les 30 derniers messages
		if (history.length > 30) {
			history = history.slice(-30);
		}

		// Sauvegarder l'historique (sans la réponse)
		ctx.waitUntil(cache.put(
			`https://memory/${session}`, 
			new Response(JSON.stringify(history), {
				headers: { "cache-control": "max-age=86400" }
			})
		));

		// Construire les messages avec système
		const fullMessages = [
			{ role: "system", content: SYSTEM_PROMPT },
			...history
		];

		// Appel à l'IA avec streaming
		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages: fullMessages,
				max_tokens: 1024,
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
			JSON.stringify({ error: "Failed to process request" }),
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
		
		const cache = await caches.open('okitakoy-memory');
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
			JSON.stringify({ error: "Failed to clear memory" }),
			{ status: 500, headers: { "content-type": "application/json" } }
		);
	}
}
