const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_DELAY = 100;
const PENALTY_INCREMENT = 200;
const GAME_FETCH_LIMIT = 50;
const PASS_FETCH_LIMIT = 100;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function throttledGet(url, params) {
	let currentDelay = BASE_DELAY;
	let penaltyDelay = 0;

	while (true) {
		await delay(currentDelay + penaltyDelay);

		try {
			const res = await axios.get(url, { params });
			penaltyDelay = 0;
			return res;
		} catch (err) {
			const isRateLimit = err?.response?.data?.errors?.some(e => e.message.includes('Too many requests'));

			if (isRateLimit) {
				penaltyDelay += PENALTY_INCREMENT;
				console.warn(`[RateLimit] Increasing penalty delay to ${penaltyDelay}ms`);
			} else {
				throw err;
			}
		}
	}
}

async function fetchAllUserGames(userId) {
	const games = [];
	let cursor = null;

	do {
		const res = await throttledGet(`https://games.roblox.com/v2/users/${userId}/games`, {
			limit: GAME_FETCH_LIMIT,
			sortOrder: "Asc",
			cursor
		});

		games.push(...(res.data.data || []));
		cursor = res.data.nextPageCursor;
	} while (cursor);

	return games;
}

async function fetchAllGamePasses(universeId) {
	const passes = [];
	let cursor = null;

	do {
		const res = await throttledGet(`https://games.roblox.com/v1/games/${universeId}/game-passes`, {
			limit: PASS_FETCH_LIMIT,
			sortOrder: "Asc",
			cursor
		});

		passes.push(...(res.data.data || []));
		cursor = res.data.nextPageCursor;
	} while (cursor);

	return passes;
}

async function fetchGamePasses(userId) {
	console.time(`[Benchmark] Fetched all passes for user ${userId} in`);

	const allPasses = [];
	const games = await fetchAllUserGames(userId);

	for (const [index, game] of games.entries()) {
		console.log(`[Fetch] [${index + 1}] ${game.name} (Universe ID: ${game.id})`);

		const passes = await fetchAllGamePasses(game.id);

		for (const pass of passes) {
			if (pass.price != null) {
				allPasses.push({
					id: pass.id,
					name: pass.name,
					price: pass.price,
					type: 'GamePass'
				});
			}
		}
	}

	console.timeEnd(`[Benchmark] Fetched all passes for user ${userId} in`);

	return allPasses;
}

app.get('/user-items/:userId', async (req, res) => {
	const userId = req.params.userId;

	if (!userId) {
		return res.status(400).json({ error: 'Missing userId' });
	}

	try {
		const passes = await fetchGamePasses(userId);
		const sorted = passes.sort((a, b) => a.price - b.price);

		res.json({ items: sorted });
	} catch (err) {
		console.error(`[Error] Fetching user items:`, err?.response?.data || err.message || err);
		res.status(500).json({ error: 'Failed to fetch user items' });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`[Startup] Proxy running on port ${PORT}`);
});
