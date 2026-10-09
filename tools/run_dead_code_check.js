// Гейт мёртвого кода и утёкших глобалов. Обходит области видимости каждого .lua в addons/ (кроме libs/) и
// проверяет две вещи, которых не видит ни синтаксис, ни игра:
//   1) объявленный и ни разу не прочитанный локал. Сам по себе безвреден, но это след правки, которую
//      бросили на середине: `local min, max = ...` там, где max взяли из глобала, `local func, error = ...`,
//      перекрывающий error(), оставленный после рефакторинга `local bindings = {}`. Порог жёсткий -- ноль:
//      имя, которое действительно не нужно, пишется как `_`.
//   2) чтение имени, которое проект нигде не присваивает. Это либо API клиента (тогда имя лежит в
//      tools/dead_code_baseline.json с пояснением, откуда берётся), либо опечатка, либо вызов функции,
//      которой на 3.3.5a нет -- а такое в игре выглядит как молча неработающая ветка, без ошибки в чат.
//      Гейт сверяется с базовой линией, поэтому ловит именно НОВОЕ имя, а не полноту белого списка.
//
//   node tools/run_dead_code_check.js                     -- всё дерево addons/
//   node tools/run_dead_code_check.js <файл> [<файл>...]   -- только указанные файлы (базовая линия не сверяется)
//
// Нужен luaparse (лежит рядом с MRT, путь переопределяется через AW_LUAPARSE).
const fs = require('fs');
const path = require('path');
const LUAPARSE = process.env.AW_LUAPARSE
  || 'C:/Games/backport/MRT-3.3.5a/tools/luacheck/node_modules/luaparse';
let luaparse = null;
try { luaparse = require(LUAPARSE); } catch (e) {
  try { luaparse = require('luaparse'); } catch (e2) {
    console.log('FAIL: luaparse не найден. Поставь AW_LUAPARSE=<путь> или npm i luaparse в tools/.');
    process.exit(1);
  }
}

const root = path.join(__dirname, '..');
const targets = process.argv.slice(2);
const files = targets.length ? targets : (() => {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'libs') walk(full); }
    else if (e.name.endsWith('.lua')) out.push(full);
  });
  walk(path.join(root, 'addons'));
  return out;
})();

const globalReads = new Map();   // name -> [ {file,line} ]
const globalWrites = new Set();  // name assigned somewhere in the project
const unusedLocals = [];         // {file,line,name}
let parseFails = 0;

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = luaparse.parse(src, { locations: true, luaVersion: '5.1', comments: false });
  } catch (e) {
    parseFails++;
    console.log('FAIL не разобрался ' + path.relative(root, file) + ': ' + e.message);
    return;
  }
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const stack = [new Map()]; // name -> decl record {name,line,used}

  const declare = (name, line, kind) => {
    const rec = { name, line, used: false, kind };
    stack[stack.length - 1].set(name, rec);
    return rec;
  };
  const resolve = (name) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const rec = stack[i].get(name);
      if (rec) return rec;
    }
    return null;
  };
  const push = () => stack.push(new Map());
  const pop = () => {
    const frame = stack.pop();
    frame.forEach((rec) => {
      if (!rec.used && rec.kind === 'local' && rec.name !== '_' && !rec.name.startsWith('_')) {
        unusedLocals.push({ file: rel, line: rec.line, name: rec.name });
      }
    });
  };

  const readIdent = (node) => {
    const rec = resolve(node.name);
    if (rec) { rec.used = true; return; }
    if (!globalReads.has(node.name)) globalReads.set(node.name, []);
    globalReads.get(node.name).push({ file: rel, line: node.loc.start.line });
  };

  function expr(node) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier': readIdent(node); break;
      case 'MemberExpression': expr(node.base); break;          // .identifier -- имя поля, не переменная
      case 'IndexExpression': expr(node.base); expr(node.index); break;
      case 'CallExpression': expr(node.base); node.arguments.forEach(expr); break;
      case 'TableCallExpression': expr(node.base); node.arguments.forEach(expr); break;
      case 'StringCallExpression': expr(node.base); expr(node.argument); break;
      case 'BinaryExpression': case 'LogicalExpression': expr(node.left); expr(node.right); break;
      case 'UnaryExpression': expr(node.argument); break;
      case 'FunctionDeclaration': funcBody(node, false); break;
      case 'TableConstructorExpression':
        node.fields.forEach((f) => {
          if (f.type === 'TableKey') expr(f.key);               // [expr] = ...
          expr(f.value);                                        // TableKeyString.key -- имя поля
        });
        break;
      default: break; // литералы, vararg
    }
  }

  function funcBody(node, isMethod) {
    push();
    if (isMethod) declare('self', node.loc.start.line, 'param');
    node.parameters.forEach((p) => {
      if (p.type === 'Identifier') declare(p.name, p.loc.start.line, 'param');
    });
    node.body.forEach(stmt);
    pop();
  }

  function assignTarget(node) {
    if (node.type === 'Identifier') {
      const rec = resolve(node.name);
      if (rec) { rec.used = true; return; } // запись в локал -- не считаем «неиспользованным»
      globalWrites.add(node.name);
      return;
    }
    expr(node); // t.x = / t[k] = -- база читается
  }

  function stmt(node) {
    if (!node) return;
    switch (node.type) {
      case 'LocalStatement':
        node.init.forEach(expr);
        node.variables.forEach((v) => declare(v.name, v.loc.start.line, 'local'));
        break;
      case 'AssignmentStatement':
        node.init.forEach(expr);
        node.variables.forEach(assignTarget);
        break;
      case 'CallStatement': expr(node.expression); break;
      case 'FunctionDeclaration': {
        const id = node.identifier;
        if (node.isLocal && id && id.type === 'Identifier') {
          declare(id.name, id.loc.start.line, 'local'); // виден внутри своего тела
          funcBody(node, false);
        } else {
          let isMethod = false;
          if (id && id.type === 'MemberExpression') { isMethod = id.indexer === ':'; expr(id.base); }
          else if (id && id.type === 'Identifier') globalWrites.add(id.name);
          funcBody(node, isMethod);
        }
        break;
      }
      case 'IfStatement':
        node.clauses.forEach((c) => { expr(c.condition); push(); c.body.forEach(stmt); pop(); });
        break;
      case 'WhileStatement': expr(node.condition); push(); node.body.forEach(stmt); pop(); break;
      case 'DoStatement': push(); node.body.forEach(stmt); pop(); break;
      case 'RepeatStatement': push(); node.body.forEach(stmt); expr(node.condition); pop(); break;
      case 'ForNumericStatement':
        expr(node.start); expr(node.end); expr(node.step);
        push(); declare(node.variable.name, node.variable.loc.start.line, 'param');
        node.body.forEach(stmt); pop();
        break;
      case 'ForGenericStatement':
        node.iterators.forEach(expr);
        push(); node.variables.forEach((v) => declare(v.name, v.loc.start.line, 'param'));
        node.body.forEach(stmt); pop();
        break;
      case 'ReturnStatement': node.arguments.forEach(expr); break;
      case 'LocalFunctionStatement': funcBody(node, false); break;
      default: break; // Break
    }
  }

  ast.body.forEach(stmt);
  pop();
}

files.forEach(scan);

// Белый список: Lua 5.1 + то, что реально зовёт этот проект из FrameXML. Имя, которого здесь нет и которое
// нигде в проекте не присваивается, -- кандидат в опечатку.
const KNOWN = new Set((`
_G _VERSION assert collectgarbage dofile error getfenv getmetatable ipairs load loadfile loadstring next
pairs pcall print rawequal rawget rawlen rawset select setfenv setmetatable tonumber tostring type unpack
xpcall coroutine debug math os string table bit newproxy gcinfo
CreateFrame UIParent GameTooltip WorldFrame GetTime GetCVar SetCVar GetCVarBool GetCVarDefault
UnitName UnitGUID UnitExists UnitHealth UnitHealthMax UnitPower UnitPowerMax UnitIsUnit UnitClass
UnitClassification UnitCreatureType UnitLevel UnitIsPlayer UnitReaction UnitIsEnemy UnitIsFriend
UnitAura UnitBuff UnitDebuff UnitCanAttack UnitIsDead UnitIsDeadOrGhost UnitIsTapped UnitIsTappedByPlayer
UnitThreatSituation UnitDetailedThreatSituation UnitAffectingCombat UnitInParty UnitInRaid UnitIsCharmed
UnitPlayerControlled UnitSelectionColor UnitIsPVP UnitRace UnitSex UnitGroupRolesAssigned
GetSpellInfo GetSpellTexture GetSpellCooldown GetSpellLink IsSpellInRange IsSpellKnown GetNumGroupMembers
GetRaidTargetIndex SetRaidTargetIndex GetNumRaidMembers GetNumPartyMembers GetUnitName
InCombatLockdown IsInInstance IsAddOnLoaded LoadAddOn GetAddOnMetadata GetNumAddOns GetAddOnInfo
EnableAddOn DisableAddOn RegisterStateDriver UnregisterStateDriver RegisterAttributeDriver
SecureHandlerSetFrameRef SecureHandler_OnClick ClearOverrideBindings SetOverrideBindingClick
GetMouseFocus GetCursorPosition GetScreenWidth GetScreenHeight UIParentLoadAddOn
SlashCmdList SLASH_ITF1 SLASH_ITF2 hooksecurefunc issecurevariable securecall
LibStub GetLocale GetRealmName UnitFactionGroup GetSpecialization GetPrimaryTalentTree
GetTalentTabInfo GetNumTalentTabs GetActiveTalentGroup GetTalentInfo
ChatFrame1 DEFAULT_CHAT_FRAME ChatFrame_AddMessageEventFilter StaticPopup_Show StaticPopupDialogs
PlaySound PlaySoundFile Screenshot ReloadUI ConsoleExec
RAID_CLASS_COLORS CLASS_SORT_ORDER LOCALIZED_CLASS_NAMES_MALE FACTION_BAR_COLORS
PowerBarColor DebuffTypeColor ITEM_QUALITY_COLORS
GameFontNormal GameFontHighlight GameFontHighlightSmall GameFontNormalSmall NumberFontNormal
ChatFontNormal GameFontDisableSmall GameFontWhite TooltipBorder
BackdropTemplateMixin UISpecialFrames UIDropDownMenu_Initialize UIDropDownMenu_AddButton
UIDropDownMenu_SetSelectedValue UIDropDownMenu_GetSelectedValue ToggleDropDownMenu CloseDropDownMenus
UIDropDownMenu_SetWidth UIDropDownMenu_SetText UIDropDownMenu_CreateInfo
ColorPickerFrame OpacitySliderFrame ShowUIPanel HideUIPanel
C_NamePlate C_Timer AW_NamePlates AW_NamePlateGuids AW_NamePlateList AwesomeWotlk
GetBuildInfo GetFramerate debugprofilestop debugstack geterrorhandler seterrorhandler
GetBindingKey SetBinding SaveBindings GetCurrentBindingSet GetNumBindings GetBinding
IsShiftKeyDown IsControlKeyDown IsAltKeyDown IsModifiedClick GetModifiedClick
TargetUnit FocusUnit AssistUnit CastSpellByName UseInventoryItem RunMacroText
ElvUI AddOnSkins WeakAuras Cell DBM
math_floor math_max math_min string_format table_insert
`).trim().split(/\s+/));

const suspects = [...globalReads.entries()]
  .filter(([name]) => !KNOWN.has(name) && !globalWrites.has(name))
  .sort((a, b) => a[0].localeCompare(b[0]));

let failures = parseFails;
let checks = parseFails ? 1 : 0;

// 1) утёкшие глобалы против базовой линии. Выборочный прогон (аргументы) базовую линию не сверяет: по
//    одному файлу нельзя узнать, присваивается ли имя где-то рядом, -- иначе гейт врал бы.
const BASELINE = path.join(__dirname, 'dead_code_baseline.json');
if (targets.length) {
  console.log('(выборочный прогон: базовая линия глобалов не сверяется)');
  suspects.forEach(([name, hits]) => console.log('  ? ' + name + '  ' + hits[0].file + ':' + hits[0].line));
} else {
  let baseline = null;
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (e) { /* ниже */ }
  checks++;
  if (!baseline) {
    failures++;
    console.log('FAIL базовая линия tools/dead_code_baseline.json не читается -- проверка глобалов ослепла');
  } else {
    const known = new Set(Object.keys(baseline).filter((k) => !/^_+$/.test(k)));
    const fresh = suspects.filter(([name]) => !known.has(name));
    const stale = [...known].filter((name) => !suspects.some(([n]) => n === name));
    if (fresh.length) {
      failures++;
      console.log(`FAIL новых неизвестных глобалов: ${fresh.length} -- либо опечатка, либо вызов, которого`
        + ' на 3.3.5a нет; если имя законное -- внеси его в tools/dead_code_baseline.json с пояснением');
      fresh.forEach(([name, hits]) => {
        const where = hits.slice(0, 3).map((h) => h.file + ':' + h.line).join(', ');
        console.log('       ' + name + '  x' + hits.length + '  ' + where + (hits.length > 3 ? ' …' : ''));
      });
    } else {
      console.log(`ok   глобалы: ${suspects.length} чтений внешних имён, все в базовой линии`);
    }
    if (stale.length) {
      // не провал: удалить код -- нормальное дело, но запись в базовой линии после этого лишняя
      console.log('     к сведению: в базовой линии больше не нужны -- ' + stale.join(', '));
    }
  }
}

// 2) мёртвые локалы. Порог -- ноль: ненужное значение пишется как `_`.
checks++;
unusedLocals.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
if (unusedLocals.length) {
  failures++;
  console.log(`FAIL объявленных и ни разу не прочитанных локалов: ${unusedLocals.length}`
    + ' -- либо имя действительно не нужно (тогда `_`), либо правку бросили на середине');
  unusedLocals.forEach((u) => console.log('       ' + u.file + ':' + u.line + '  ' + u.name));
} else {
  console.log('ok   мёртвых локалов нет (' + files.length + ' файлов)');
}

console.log(failures ? `Проверки мёртвого кода: ПРОВАЛ (${failures})` : 'Проверки мёртвого кода: зелёный — ' + checks + ' проверок');
process.exit(failures ? 1 : 0);
