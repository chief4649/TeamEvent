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
    omitSetCounts: false,
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
      case "--omit-set-counts":
        args.omitSetCounts = true;
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
    "  --omit-set-counts Print JA singles without 3(...)2 set counts",
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

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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
  const raw = String(value || "").trim();
  const text = normalizeText(value);
  const compactRaw = raw.replace(/\s+/g, "").toLowerCase();

  if (!raw && !text) {
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

  const japaneseRoundNumberMatch = compactRaw.match(/^第?([0-9０-９]+)回戦$/);
  if (japaneseRoundNumberMatch) {
    const roundNumber = Number(japaneseRoundNumberMatch[1].replace(/[０-９]/g, (digit) =>
      String("０１２３４５６７８９".indexOf(digit))));
    return Number.isFinite(roundNumber) ? `knockout_round_${roundNumber}` : null;
  }

  const japaneseAliases = [
    ["quarterfinal", ["準々決勝", "準準決勝"]],
    ["semifinal", ["準決勝"]],
    ["final", ["決勝"]],
    ["round_of_128", ["ベスト128", "128強"]],
    ["round_of_64", ["ベスト64", "64強"]],
    ["round_of_32", ["ベスト32", "32強"]],
    ["round_of_16", ["ベスト16", "16強"]],
    ["qualifying", ["予選"]],
    ["group", ["グループ", "予選リーグ"]],
    ["preliminary_round", ["予備ラウンド"]],
  ];

  for (const [canonical, values] of japaneseAliases) {
    if (values.some((alias) => compactRaw === alias.toLowerCase() || compactRaw.includes(alias.toLowerCase()))) {
      return canonical;
    }
  }

  const aliases = [
    ["quarterfinal", ["quarterfinal", "quarterfinals", "quarter final", "quarter finals", "quarter-final", "quarter-finals", "qf"]],
    ["semifinal", ["semifinal", "semifinals", "semi final", "semi finals", "semi-final", "semi-finals", "sf"]],
    ["round_of_128", ["round of 128", "r128", "best 128"]],
    ["round_of_64", ["round of 64", "r64", "best 64"]],
    ["round_of_16", ["round of 16", "r16", "best 16"]],
    ["round_of_32", ["round of 32", "r32", "best 32"]],
    ["final", ["final", "f"]],
    ["group", ["group", "pool"]],
  ];

  for (const [canonical, values] of aliases) {
    if (values.some((alias) => text === alias)) {
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

function matchesRoundFilter(matchRoundKey, wantedRound, context = null) {
  if (!matchRoundKey || !wantedRound) {
    return false;
  }

  if (matchRoundKey === wantedRound) {
    return true;
  }

  if (wantedRound === "group") {
    return matchRoundKey === "group" || matchRoundKey.endsWith("_group");
  }

  if (wantedRound === "qualifying") {
    return (
      matchRoundKey === "preliminary_round" ||
      matchRoundKey === "group" ||
      matchRoundKey.startsWith("group ") ||
      matchRoundKey.endsWith("_group")
    );
  }

  if (wantedRound === "stage_1a" || wantedRound === "stage_1b") {
    return matchRoundKey === wantedRound || matchRoundKey === `${wantedRound}_group`;
  }

  const knockoutRoundMatch = String(wantedRound).match(/^knockout_round_(\d+)$/);
  if (knockoutRoundMatch) {
    return context?.knockoutRoundNumbers?.[matchRoundKey] === `${knockoutRoundMatch[1]}回戦`;
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

function getNameTranslationCandidates(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  const collapsed = raw.replace(/\s+/g, " ");
  const candidates = [raw];

  if (collapsed !== raw) {
    candidates.push(collapsed);
  }

  const parts = collapsed.split(" ").filter(Boolean);
  if (parts.length === 2) {
    candidates.push(`${parts[1]} ${parts[0]}`);
  }

  return [...new Set(candidates)];
}

function translatePlayer(value, translations) {
  const candidates = getNameTranslationCandidates(value);

  for (const candidate of candidates) {
    if (translations.players?.[candidate]) {
      return translations.players[candidate];
    }
  }

  return value;
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

function getSearchTermsForTeam(team, translations) {
  return [
    team?.name,
    team?.org,
    translateTeam(team, translations),
    translations.teams?.[team?.org || ""],
  ].filter(Boolean);
}

function getSearchTermsForSingle(single, translations) {
  return (single?.competitors || []).flatMap((competitor) => {
    const names = [
      competitor?.name,
      competitor?.org,
      ...getNameTranslationCandidates(competitor?.name),
      translatePlayer(competitor?.name || "", translations),
      ...((competitor?.players || []).flatMap((player) => [
        player?.name,
        ...getNameTranslationCandidates(player?.name),
        translatePlayer(player?.name || "", translations),
      ])),
      translations.teams?.[competitor?.org || ""],
    ];

    return names.filter(Boolean);
  });
}

function buildMatchSearchText(match, translations) {
  return normalizeSearchText(
    [
      match.description,
      match.subEventType,
      match.roundLabel,
      match.roundKey,
      ...match.teams.flatMap((team) => getSearchTermsForTeam(team, translations)),
      ...match.singles.flatMap((single) => getSearchTermsForSingle(single, translations)),
    ].join(" "),
  );
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
    gameScores: splitGameScores(result?.gameScores ?? result?.resultsGameScores),
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

function applyFilters(matches, args, translations) {
  let filtered = matches.filter(Boolean);

  if (args.gender) {
    const wantedGender = inferGender(args.gender);
    filtered = filtered.filter((match) => match.gender === wantedGender);
  }

  if (args.round) {
    const wantedRound = normalizeRound(args.round);
    const roundContext = buildJaRoundContext(filtered);
    filtered = filtered.filter((match) => matchesRoundFilter(match.roundKey, wantedRound, roundContext));
  }

  if (args.team) {
    const needle = normalizeSearchText(args.team);
    filtered = filtered.filter((match) =>
      match.teams.some((team) =>
        normalizeSearchText(getSearchTermsForTeam(team, translations).join(" ")).includes(needle),
      ),
    );
  }

  if (args.contains) {
    const needle = normalizeSearchText(args.contains);
    filtered = filtered.filter((match) => buildMatchSearchText(match, translations).includes(needle));
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

function getDisplayedTeamIndexes(match) {
  const leftIndex = getTieDisplaySide(match);
  return {
    leftIndex,
    rightIndex: leftIndex === 0 ? 1 : 0,
    leftOrg: match?.teams?.[leftIndex]?.org ?? null,
    rightOrg: match?.teams?.[leftIndex === 0 ? 1 : 0]?.org ?? null,
  };
}

function getSingleDisplayIndexes(single, displayedTeams) {
  const leftOrg = displayedTeams?.leftOrg ?? null;
  const rightOrg = displayedTeams?.rightOrg ?? null;
  const competitors = Array.isArray(single?.competitors) ? single.competitors : [];

  const leftByOrg = competitors.findIndex((competitor) => competitor?.org && competitor.org === leftOrg);
  const rightByOrg = competitors.findIndex((competitor) => competitor?.org && competitor.org === rightOrg);

  if (leftByOrg >= 0 && rightByOrg >= 0 && leftByOrg !== rightByOrg) {
    return {
      leftCompetitorIndex: leftByOrg,
      rightCompetitorIndex: rightByOrg,
    };
  }

  const leftCompetitorIndex = single?.tieLeftCompetitorIndex ?? 0;
  return {
    leftCompetitorIndex,
    rightCompetitorIndex: leftCompetitorIndex === 0 ? 1 : 0,
  };
}

function formatIndividualScoreJa(match, leftCompetitorIndex, options = {}) {
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

  if (options.omitSetCounts) {
    return normalizedGames.join(",");
  }

  return `${leftSets}(${normalizedGames.join(",")})${rightSets}`;
}

function buildJaRoundContext(matches) {
  const knockoutOrder = [
    "round_of_128",
    "round_of_64",
    "round_of_32",
    "round_of_16",
    "quarterfinal",
    "semifinal",
    "final",
  ];
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
  const { leftIndex, rightIndex } = getDisplayedTeamIndexes(match);
  const rawScore = String(match.overallScore || "-");
  const [scoreA, scoreB] = rawScore.split("-");
  const score = leftIndex === 1 ? `${scoreB}-${scoreA}` : rawScore;
  const left = translateTeam(match.teams[leftIndex], translations);
  const right = translateTeam(match.teams[rightIndex], translations);
  return `　${left}　${score}　${right}`;
}

function formatJaSinglesLine(single, translations, displayedTeams, options = {}) {
  const { leftCompetitorIndex, rightCompetitorIndex } = getSingleDisplayIndexes(single, displayedTeams);
  const score = formatIndividualScoreJa(single, leftCompetitorIndex, options);
  const left = translatePlayer(single.competitors[leftCompetitorIndex]?.name || "", translations);
  const right = translatePlayer(single.competitors[rightCompetitorIndex]?.name || "", translations);
  const winnerIndex = getWinnerIndexFromScore(single.overallScore);

  if (winnerIndex === leftCompetitorIndex) {
    return `○${left}　${score}　${right}`;
  }
  if (winnerIndex === rightCompetitorIndex) {
    return `　${left}　${score}　${right}○`;
  }
  return `　${left}　${score}　${right}`;
}

function formatJaPendingLine(match, index, translations, displayedTeams) {
  const leftPlayers = match.singles.slice(0, 3).map((single) => {
    const { leftCompetitorIndex } = getSingleDisplayIndexes(single, displayedTeams);
    return single.competitors[leftCompetitorIndex]?.name || "";
  });
  const rightPlayers = match.singles.slice(0, 3).map((single) => {
    const { rightCompetitorIndex } = getSingleDisplayIndexes(single, displayedTeams);
    return single.competitors[rightCompetitorIndex]?.name || "";
  });
  const schedule = [
    [leftPlayers[0], rightPlayers[1]],
    [leftPlayers[1], rightPlayers[0]],
  ];
  const pair = schedule[index - 4] || [];
  const left = translatePlayer(pair[0] || "", translations);
  const right = translatePlayer(pair[1] || "", translations);
  return `　${left}　-　${right}`;
}

function formatJapanese(matches, translations, rules, roundContext, options = {}) {
  return matches
    .map((match) => {
      const displayedTeams = getDisplayedTeamIndexes(match);
      const lines = [
        formatJaHeader({ ...match, roundContext }, translations, rules),
        formatJaTeamLine(match, translations),
        ...match.singles.map((single) =>
          formatJaSinglesLine(single, translations, displayedTeams, options),
        ),
      ];

      for (let i = match.singles.length + 1; i <= 5; i += 1) {
        lines.push(formatJaPendingLine(match, i, translations, displayedTeams));
      }

      return lines.join("\n");
    })
    .join("\n\n");
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
    omitSetCounts: false,
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
  const translations = readTranslations(args.translations);
  const filtered = applyFilters(normalized, args, translations);
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
    return formatJapanese(filtered, translations, rules, jaRoundContext, {
      omitSetCounts: args.omitSetCounts,
    });
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
