#!/usr/bin/env node

const API_URL = "https://liveeventsapi.worldtabletennis.com/api/cms/GetOfficialResult";
const DEFAULT_TAKE = 200;
const fs = require("fs");
const path = require("path");

const DEFAULT_TRANSLATIONS_PATH = path.join(__dirname, "translations.ja.json");
const DEFAULT_RULES_PATH = path.join(__dirname, "rules.json");
const DEFAULT_CACHE_DIR = path.join(__dirname, ".cache");

function parseArgs(argv) {
  const args = {
    event: null,
    gender: null,
    round: null,
    team: null,
    contains: null,
    docCode: null,
    limit: null,
    take: DEFAULT_TAKE,
    json: false,
    list: false,
    pretty: true,
    ja: false,
    translations: DEFAULT_TRANSLATIONS_PATH,
    cacheDir: DEFAULT_CACHE_DIR,
    refreshCache: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--event":
      case "-e":
        args.event = next;
        i += 1;
        break;
      case "--gender":
      case "-g":
        args.gender = next;
        i += 1;
        break;
      case "--round":
      case "--stage":
      case "-r":
        args.round = next;
        i += 1;
        break;
      case "--team":
      case "-t":
        args.team = next;
        i += 1;
        break;
      case "--contains":
      case "-q":
        args.contains = next;
        i += 1;
        break;
      case "--doc-code":
      case "-d":
        args.docCode = next;
        i += 1;
        break;
      case "--limit":
      case "-n":
        args.limit = Number(next);
        i += 1;
        break;
      case "--take":
        args.take = Number(next);
        i += 1;
        break;
      case "--json":
        args.json = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--compact":
        args.pretty = false;
        break;
      case "--ja":
        args.ja = true;
        break;
      case "--translations":
        args.translations = next;
        i += 1;
        break;
      case "--rules":
        args.rules = next;
        i += 1;
        break;
      case "--cache-dir":
        args.cacheDir = next;
        i += 1;
        break;
      case "--refresh-cache":
        args.refreshCache = true;
        break;
      case "--help":
      case "-h":
        printHelp(0);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  if (!args.event) {
    throw new Error("--event is required");
  }

  return args;
}

function printHelp(exitCode = 0) {
  const lines = [
    "Usage:",
    "  node extract_team_matches.js --event 2751 [options]",
    "",
    "Options:",
    "  --gender, -g     men | women",
    "  --round, -r      quarterfinal | semifinal | final | 'round of 16'",
    "  --team, -t       Filter by team name or country code",
    "  --contains, -q   Free-text filter across description and team names",
    "  --doc-code, -d   Exact team match document code",
    "  --limit, -n      Limit output matches",
    "  --take           API page size to request, default 200",
    "  --json           Print normalized JSON",
    "  --list           Print one-line summaries only",
    "  --compact        Compact JSON output",
    "  --ja             Print Japanese-style formatted output",
    "  --translations   Path to Japanese name mapping JSON",
    "  --rules          Path to formatter rules JSON",
    "  --cache-dir      Directory for API response cache",
    "  --refresh-cache  Ignore cache and refetch from API",
    "",
    "Examples:",
    "  node extract_team_matches.js --event 2751 --gender men --round quarterfinal",
    "  node extract_team_matches.js --event 2751 --team Japan --json",
  ];

  console.log(lines.join("\n"));
  process.exit(exitCode);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferGender(value) {
  const text = normalizeText(value);
  if (text === "women" || text === "womens" || text === "female") {
    return "women";
  }
  if (text === "men" || text === "mens" || text === "male") {
    return "men";
  }
  if (text.includes("womens team") || text.includes("womens teams") || text.includes("women team")) {
    return "women";
  }
  if (text.includes("mens team") || text.includes("mens teams") || text.includes("men team")) {
    return "men";
  }
  return null;
}

function normalizeRound(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const stageMatch = text.match(/\bstage\s*1\s*([ab])\b/);
  const hasGroup = /\bgroup\b|\bpool\b/.test(text);
  if (stageMatch) {
    const stageKey = `stage_1${stageMatch[1]}`;
    return hasGroup ? `${stageKey}_group` : stageKey;
  }

  if (text.includes("preliminary round")) {
    return "preliminary_round";
  }

  const aliases = [
    ["quarterfinal", ["quarterfinal", "quarter final", "qf"]],
    ["semifinal", ["semifinal", "semi final", "sf"]],
    ["final", ["final"]],
    ["round_of_128", ["round of 128", "r128"]],
    ["round_of_64", ["round of 64", "r64"]],
    ["round_of_16", ["round of 16", "r16"]],
    ["round_of_32", ["round of 32", "r32"]],
    ["group", ["group", "pool"]],
  ];

  for (const [canonical, values] of aliases) {
    if (values.some((alias) => text === alias || text.includes(alias))) {
      return canonical;
    }
  }

  return text || null;
}

function extractRound(description) {
  const raw = String(description || "");
  const segments = raw
    .split(/\s+-\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const roundParts = segments.slice(1).filter((segment) => !/^Match\b/i.test(segment));
  const roundLabel = roundParts.length ? roundParts.join(" - ") : null;
  return {
    roundLabel,
    roundKey: normalizeRound(roundLabel),
  };
}

function matchesRoundFilter(matchRoundKey, wantedRound) {
  if (!matchRoundKey || !wantedRound) {
    return false;
  }

  if (matchRoundKey === wantedRound) {
    return true;
  }

  if (wantedRound === "group") {
    return matchRoundKey === "group" || matchRoundKey.endsWith("_group");
  }

  if (wantedRound === "stage_1a" || wantedRound === "stage_1b") {
    return matchRoundKey === wantedRound || matchRoundKey === `${wantedRound}_group`;
  }

  return false;
}

function extractMatchNumber(description) {
  const match = String(description || "").match(/\bMatch\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function splitGameScores(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry !== "0-0");
}

function normalizePlayer(player) {
  if (!player) {
    return null;
  }

  return {
    id: player.playerId ?? null,
    name: player.playerName ?? null,
    org: player.playerOrgCode ?? null,
    position: player.playerPosition ?? null,
  };
}

function normalizeCompetitor(competitor) {
  if (!competitor) {
    return null;
  }

  return {
    type: competitor.competitorType ?? competitor.competitor_type ?? null,
    id: competitor.competitiorId ?? competitor.competitior_id ?? null,
    name: competitor.competitiorName ?? competitor.competitior_name ?? null,
    org: competitor.competitiorOrg ?? competitor.competitior_org ?? null,
    irm: competitor.irm ?? null,
    players: Array.isArray(competitor.players) ? competitor.players.map(normalizePlayer) : [],
  };
}

function readTranslations(filePath) {
  const parsed = readJsonFile(filePath, { teams: {}, players: {}, rounds: {}, headers: {} }, "translations");
  return {
    teams: parsed.teams || {},
    players: parsed.players || {},
    rounds: parsed.rounds || {},
    headers: parsed.headers || {},
  };
}

function readRules(filePath) {
  const parsed = readJsonFile(
    filePath,
    {
      labels: {
        knockoutPrefix: "決勝トーナメント",
        groupPrefix: "グループ",
        stageDisplay: {
          stage_1a: "Stage1A",
          stage_1a_group: "Stage1Aグループ",
          stage_1b: "Stage1B",
          stage_1b_group: "Stage1Bグループ",
        },
        preliminaryRound: "予備ラウンド",
      },
      roundFallbacks: {
        quarterfinal: "決勝トーナメント準々決勝",
        semifinal: "決勝トーナメント準決勝",
        final: "決勝",
        round_of_128: "決勝トーナメント1回戦",
        round_of_64: "決勝トーナメント2回戦",
        round_of_16: "決勝トーナメント1回戦",
        round_of_32: "決勝トーナメント2回戦",
      },
    },
    "rules",
  );

  return {
    labels: {
      knockoutPrefix: parsed.labels?.knockoutPrefix || "決勝トーナメント",
      groupPrefix: parsed.labels?.groupPrefix || "グループ",
      stageDisplay: parsed.labels?.stageDisplay || {},
      preliminaryRound: parsed.labels?.preliminaryRound || "予備ラウンド",
    },
    roundFallbacks: parsed.roundFallbacks || {},
  };
}

function readJsonFile(filePath, fallback, label) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function translate(value, dictionary) {
  return dictionary?.[value] || value;
}

function translateTeam(team, translations) {
  const rawName = team?.name || "";
  const normalizedName = rawName.replace(/\s+\d+$/, "");
  const candidates = [rawName, normalizedName, team?.org].filter(Boolean);

  for (const candidate of candidates) {
    if (translations.teams?.[candidate]) {
      return translations.teams[candidate];
    }
  }

  return rawName;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getCachePath(cacheDir, eventId, take) {
  return path.join(cacheDir, `event_${eventId}_take_${take}.json`);
}

function readCache(cachePath) {
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}

function writeCache(cachePath, payload) {
  ensureDir(path.dirname(cachePath));
  fs.writeFileSync(cachePath, JSON.stringify(payload), "utf8");
}

function normalizeIndividualMatch(entry, index) {
  const result = entry?.match_result ?? entry?.matchResult ?? null;
  const competitors = Array.isArray(result?.competitiors)
    ? result.competitiors.map(normalizeCompetitor)
    : Array.isArray(result?.Competitiors)
      ? result.Competitiors.map(normalizeCompetitor)
      : [];

  return {
    order: index + 1,
    documentCode: result?.documentCode ?? entry?.value ?? null,
    description: result?.subEventDescription ?? null,
    overallScore: result?.overallScores ?? null,
    resultStatus: result?.resultStatus ?? null,
    gameScores: splitGameScores(result?.gameScores),
    competitors,
    winnerOrg: inferWinnerOrg(result),
  };
}

function inferWinnerOrg(result) {
  const score = String(result?.overallScores || "");
  const values = score
    .replace(/[^\d-]/g, "")
    .split("-")
    .map((part) => Number(part));

  if (values.length !== 2 || values.some(Number.isNaN)) {
    return null;
  }

  const competitors = Array.isArray(result?.competitiors)
    ? result.competitiors
    : Array.isArray(result?.Competitiors)
      ? result.Competitiors
      : [];

  if (competitors.length < 2) {
    return null;
  }

  if (values[0] > values[1]) {
    return competitors[0]?.competitiorOrg ?? null;
  }
  if (values[1] > values[0]) {
    return competitors[1]?.competitiorOrg ?? null;
  }
  return null;
}

function normalizeTeamMatch(item) {
  const card = item?.match_card;
  if (!card) {
    return null;
  }

  const competitors = Array.isArray(card.competitiors) ? card.competitiors.map(normalizeCompetitor) : [];
  const teams = competitors.map((competitor) => ({
    name: competitor?.name ?? null,
    org: competitor?.org ?? null,
  }));
  const round = extractRound(card.subEventDescription);
  const nested = card?.teamParentData?.extended_info?.matches;

  return {
    id: item.id ?? null,
    eventId: item.eventId ?? card.eventId ?? null,
    documentCode: item.documentCode ?? card.documentCode ?? null,
    subEventType: item.subEventType ?? card.subEventName ?? null,
    gender: inferGender(item.subEventType ?? card.subEventName),
    roundLabel: round.roundLabel,
    roundKey: round.roundKey,
    matchNumber: extractMatchNumber(card.subEventDescription),
    description: card.subEventDescription ?? null,
    venue: card.venueName ?? null,
    table: card.tableName ?? card.tableNumber ?? null,
    overallScore: card.overallScores ?? null,
    resultStatus: card.resultStatus ?? item.fullResults ?? null,
    teams,
    singles: Array.isArray(nested) ? nested.map(normalizeIndividualMatch) : [],
  };
}

async function fetchOfficialResults(eventId, take) {
  const url = new URL(API_URL);
  url.searchParams.set("EventId", String(eventId));
  url.searchParams.set("include_match_card", "true");
  url.searchParams.set("take", String(take));

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://www.worldtabletennis.com",
      referer: "https://www.worldtabletennis.com/",
      "user-agent": "Mozilla/5.0 (compatible; TeamMatchExtractor/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchOfficialResultsCached(eventId, take, cacheDir, refreshCache) {
  const cachePath = getCachePath(cacheDir, eventId, take);
  if (!refreshCache) {
    const cached = readCache(cachePath);
    if (cached) {
      return cached;
    }
  }
  const payload = await fetchOfficialResults(eventId, take);
  writeCache(cachePath, payload);
  return payload;
}

function applyFilters(matches, args) {
  let filtered = matches.filter(Boolean);

  if (args.gender) {
    const wantedGender = inferGender(args.gender);
    filtered = filtered.filter((match) => match.gender === wantedGender);
  }

  if (args.round) {
    const wantedRound = normalizeRound(args.round);
    filtered = filtered.filter((match) => matchesRoundFilter(match.roundKey, wantedRound));
  }

  if (args.team) {
    const needle = normalizeText(args.team);
    filtered = filtered.filter((match) =>
      match.teams.some((team) => normalizeText(`${team.name} ${team.org}`).includes(needle)),
    );
  }

  if (args.contains) {
    const needle = normalizeText(args.contains);
    filtered = filtered.filter((match) =>
      normalizeText(
        [
          match.description,
          match.subEventType,
          ...match.teams.flatMap((team) => [team.name, team.org]),
        ].join(" "),
      ).includes(needle),
    );
  }

  if (args.docCode) {
    filtered = filtered.filter((match) => match.documentCode === args.docCode);
  }

  if (Number.isInteger(args.limit) && args.limit > 0) {
    filtered = filtered.slice(0, args.limit);
  }

  return filtered;
}

function formatGameScoreForWinnerPerspective(score, winnerIndex) {
  const [leftRaw, rightRaw] = String(score).split("-");
  const left = Number(leftRaw);
  const right = Number(rightRaw);

  if (Number.isNaN(left) || Number.isNaN(right)) {
    return score;
  }

  const winnerPoints = winnerIndex === 0 ? left : right;
  const loserPoints = winnerIndex === 0 ? right : left;
  return `${loserPoints === 0 ? 0 : loserPoints > winnerPoints ? `-${winnerPoints}` : winnerPoints === 0 ? 0 : winnerPoints === left && winnerIndex === 0 ? loserPoints : winnerPoints === right && winnerIndex === 1 ? loserPoints : ""}`;
}

function getWinnerIndexFromScore(score) {
  const [leftRaw, rightRaw] = String(score || "").split("-");
  const left = Number(leftRaw);
  const right = Number(rightRaw);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return null;
  }
  if (left > right) {
    return 0;
  }
  if (right > left) {
    return 1;
  }
  return null;
}

function getTieDisplaySide(match) {
  const winnerIndex = getWinnerIndexFromScore(match.overallScore);
  return winnerIndex === 1 ? 1 : 0;
}

function formatIndividualScoreJa(match, leftCompetitorIndex) {
  const [rawLeftSets, rawRightSets] = String(match.overallScore || "-").split("-");
  const leftSets = leftCompetitorIndex === 0 ? rawLeftSets : rawRightSets;
  const rightSets = leftCompetitorIndex === 0 ? rawRightSets : rawLeftSets;

  const normalizedGames = match.gameScores.map((game) => {
    const [rawLeft, rawRight] = String(game).split("-");
    const homePoints = Number(rawLeft);
    const awayPoints = Number(rawRight);
    if (Number.isNaN(homePoints) || Number.isNaN(awayPoints)) {
      return game;
    }

    const leftPoints = leftCompetitorIndex === 0 ? homePoints : awayPoints;
    const rightPoints = leftCompetitorIndex === 0 ? awayPoints : homePoints;
    return leftPoints > rightPoints ? String(rightPoints) : `-${leftPoints}`;
  });

  return `${leftSets}(${normalizedGames.join(",")})${rightSets}`;
}

function buildJaRoundContext(matches) {
  const knockoutOrder = ["round_of_128", "round_of_64", "round_of_32", "round_of_16"];
  const presentRounds = knockoutOrder.filter((roundKey) =>
    matches.some((match) => match.roundKey === roundKey),
  );

  return {
    knockoutRoundNumbers: Object.fromEntries(
      presentRounds.map((roundKey, index) => [roundKey, `${index + 1}回戦`]),
    ),
  };
}

function translateRoundJa(roundKey, roundLabel, translations, rules, context) {
  const mapped = translate(roundKey, translations.rounds);
  if (mapped && mapped !== roundKey) {
    return mapped;
  }

  const dynamicKnockoutLabel = context?.knockoutRoundNumbers?.[roundKey];
  if (dynamicKnockoutLabel) {
    return `${rules.labels.knockoutPrefix}${dynamicKnockoutLabel}`;
  }

  const groupMatch = String(roundLabel || "").match(/^Group\s+(\d+)$/i);
  if (groupMatch) {
    return `${rules.labels.groupPrefix}${groupMatch[1]}`;
  }

  const stageGroupMatch = String(roundLabel || "").match(/^Stage\s*1([AB])(?:\s*[\(-]?\s*Group\s+(\d+)\)?)?$/i);
  if (stageGroupMatch) {
    const stageKey = `stage_1${stageGroupMatch[1].toLowerCase()}${stageGroupMatch[2] ? "_group" : ""}`;
    const stage = rules.labels.stageDisplay[stageKey] || `Stage1${stageGroupMatch[1].toUpperCase()}`;
    const groupNumber = stageGroupMatch[2];
    return groupNumber && !stage.includes(groupNumber) ? `${stage}${groupNumber}` : stage;
  }

  const splitStageGroupMatch = String(roundLabel || "").match(/^Stage\s*1([AB])\s*-\s*Group\s+(\d+)$/i);
  if (splitStageGroupMatch) {
    const stageKey = `stage_1${splitStageGroupMatch[1].toLowerCase()}_group`;
    const stage = rules.labels.stageDisplay[stageKey] || `Stage1${splitStageGroupMatch[1].toUpperCase()}グループ`;
    return `${stage}${splitStageGroupMatch[2]}`;
  }

  const fallback = {
    stage_1a: rules.labels.stageDisplay.stage_1a || "Stage1A",
    stage_1a_group: rules.labels.stageDisplay.stage_1a_group || "Stage1Aグループ",
    stage_1b: rules.labels.stageDisplay.stage_1b || "Stage1B",
    stage_1b_group: rules.labels.stageDisplay.stage_1b_group || "Stage1Bグループ",
    preliminary_round: rules.labels.preliminaryRound,
    ...rules.roundFallbacks,
  };
  return fallback[roundKey] || roundKey;
}

function formatJaHeader(match, translations, rules) {
  const genderLabel = match.gender === "men" ? "男子" : match.gender === "women" ? "女子" : "";
  const roundLabel = translateRoundJa(match.roundKey, match.roundLabel, translations, rules, match.roundContext);
  return `▼${genderLabel}${roundLabel} 　`;
}

function formatJaTeamLine(match, translations) {
  const leftIndex = getTieDisplaySide(match);
  const rightIndex = leftIndex === 0 ? 1 : 0;
  const rawScore = String(match.overallScore || "-");
  const [scoreA, scoreB] = rawScore.split("-");
  const score = leftIndex === 1 ? `${scoreB}-${scoreA}` : rawScore;
  const left = translateTeam(match.teams[leftIndex], translations);
  const right = translateTeam(match.teams[rightIndex], translations);
  return `　${left}　${score}　${right}`;
}

function formatJaSinglesLine(single, translations) {
  const tieLeftIndex = single.tieLeftCompetitorIndex ?? 0;
  const tieRightIndex = tieLeftIndex === 0 ? 1 : 0;
  const score = formatIndividualScoreJa(single, tieLeftIndex);
  const left = translate(single.competitors[tieLeftIndex]?.name || "", translations.players);
  const right = translate(single.competitors[tieRightIndex]?.name || "", translations.players);
  const winnerIndex = getWinnerIndexFromScore(single.overallScore);

  if (winnerIndex === tieLeftIndex) {
    return `○${left}　${score}　${right}`;
  }
  if (winnerIndex === tieRightIndex) {
    return `　${left}　${score}　${right}○`;
  }
  return `　${left}　${score}　${right}`;
}

function formatJaPendingLine(match, index, translations) {
  const homePlayers = match.singles.slice(0, 3).map((single) => single.competitors[0]?.name || "");
  const awayPlayers = match.singles.slice(0, 3).map((single) => single.competitors[1]?.name || "");
  const tieLeftIndex = getTieDisplaySide(match);
  const schedule = tieLeftIndex === 0
    ? [
        [homePlayers[0], awayPlayers[1]],
        [homePlayers[1], awayPlayers[0]],
      ]
    : [
        [awayPlayers[1], homePlayers[0]],
        [awayPlayers[0], homePlayers[1]],
      ];
  const pair = schedule[index - 4] || [];
  const left = translate(pair[0] || "", translations.players);
  const right = translate(pair[1] || "", translations.players);
  return `　${left}　-　${right}`;
}

function formatJapanese(matches, translations, rules, roundContext) {
  return matches
    .map((match) => {
      const tieLeftIndex = getTieDisplaySide(match);
      const lines = [
        formatJaHeader({ ...match, roundContext }, translations, rules),
        formatJaTeamLine(match, translations),
        ...match.singles.map((single) =>
          formatJaSinglesLine({ ...single, tieLeftCompetitorIndex: tieLeftIndex }, translations),
        ),
      ];

      for (let i = match.singles.length + 1; i <= 5; i += 1) {
        lines.push(formatJaPendingLine(match, i, translations));
      }

      return lines.join("\n");
    })
    .join("\n");
}

function formatList(matches) {
  return matches
    .map((match, index) => {
      const left = match.teams[0] ? `${match.teams[0].name} (${match.teams[0].org})` : "TBD";
      const right = match.teams[1] ? `${match.teams[1].name} (${match.teams[1].org})` : "TBD";
      return `${index + 1}. ${match.description} | ${left} ${match.overallScore || ""} ${right}`.trim();
    })
    .join("\n");
}

function formatText(matches) {
  return matches
    .map((match, index) => {
      const lines = [];
      const left = match.teams[0] ? `${match.teams[0].name} (${match.teams[0].org})` : "TBD";
      const right = match.teams[1] ? `${match.teams[1].name} (${match.teams[1].org})` : "TBD";

      lines.push(`[${index + 1}] ${match.description}`);
      lines.push(`${left} ${match.overallScore || "-"} ${right}`);

      for (const singles of match.singles) {
        const home = singles.competitors[0];
        const away = singles.competitors[1];
        const gameScores = singles.gameScores.length ? singles.gameScores.join(", ") : "-";
        lines.push(
          `${singles.order}. ${home?.name || "TBD"} (${home?.org || "-"}) vs ${away?.name || "TBD"} (${away?.org || "-"}) | ${singles.overallScore || "-"} | ${gameScores}`,
        );
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function createArgs(overrides = {}) {
  const defaults = {
    event: null,
    gender: null,
    round: null,
    team: null,
    contains: null,
    docCode: null,
    limit: null,
    take: DEFAULT_TAKE,
    json: false,
    list: false,
    pretty: true,
    ja: false,
    translations: DEFAULT_TRANSLATIONS_PATH,
    rules: DEFAULT_RULES_PATH,
    cacheDir: DEFAULT_CACHE_DIR,
    refreshCache: false,
  };

  return Object.fromEntries(
    Object.entries({ ...defaults, ...overrides }).map(([key, value]) => [
      key,
      value === undefined ? defaults[key] : value,
    ]),
  );
}

async function getProcessedMatches(options = {}) {
  const args = createArgs(options);
  if (!args.event) {
    throw new Error("--event is required");
  }

  const payload = await fetchOfficialResultsCached(args.event, args.take, args.cacheDir, args.refreshCache);
  const normalized = payload.map(normalizeTeamMatch).filter(Boolean);
  const filtered = applyFilters(normalized, args);
  const translations = readTranslations(args.translations);
  const rules = readRules(args.rules);
  const jaRoundContext = buildJaRoundContext(
    normalized.filter((match) => !args.gender || match.gender === inferGender(args.gender)),
  );

  return {
    args,
    payload,
    normalized,
    filtered,
    translations,
    rules,
    jaRoundContext,
  };
}

function renderOutput(result) {
  const { args, filtered, translations, rules, jaRoundContext } = result;

  if (args.json) {
    const spacing = args.pretty ? 2 : 0;
    return JSON.stringify(filtered, null, spacing);
  }

  if (args.list) {
    return formatList(filtered);
  }

  if (args.ja) {
    return formatJapanese(filtered, translations, rules, jaRoundContext);
  }

  return formatText(filtered);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await getProcessedMatches(args);
  console.log(renderOutput(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CACHE_DIR,
  DEFAULT_RULES_PATH,
  DEFAULT_TAKE,
  DEFAULT_TRANSLATIONS_PATH,
  applyFilters,
  buildJaRoundContext,
  createArgs,
  extractRound,
  fetchOfficialResultsCached,
  formatJapanese,
  formatList,
  formatText,
  getProcessedMatches,
  inferGender,
  matchesRoundFilter,
  normalizeRound,
  normalizeTeamMatch,
  parseArgs,
  readRules,
  readTranslations,
  renderOutput,
  translateRoundJa,
};
