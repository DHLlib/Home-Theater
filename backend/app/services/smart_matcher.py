"""AC-026 智能分类映射引擎。

纯内存计算，无状态，无数据库写入。
"""
from __future__ import annotations

from app.constants import SMART_MATCH_AUTO_THRESHOLD, SMART_MATCH_SUGGEST_THRESHOLD
from app.schemas import SmartMatchItem, SmartMatchResponse, SmartMatchSummary

# ===== 匹配规则表 =====
# 每条规则定义一个系统分类的匹配逻辑
MATCH_RULES: list[dict] = [
    # ── 电影 ──
    {"system_name": "动作片",   "exact": ["动作片"],     "keywords": ["动作"],       "exclude": []},
    {"system_name": "科幻片",   "exact": ["科幻片"],     "keywords": ["科幻", "奇幻"], "exclude": []},
    {"system_name": "喜剧片",   "exact": ["喜剧片"],     "keywords": ["喜剧"],       "exclude": []},
    {"system_name": "爱情片",   "exact": ["爱情片"],     "keywords": ["爱情"],       "exclude": []},
    {"system_name": "剧情片",   "exact": ["剧情片"],     "keywords": ["剧情"],       "exclude": []},
    {"system_name": "战争片",   "exact": ["战争片"],     "keywords": ["战争"],       "exclude": []},
    {"system_name": "恐怖片",   "exact": ["恐怖片"],     "keywords": ["恐怖", "惊悚", "灾难"], "exclude": []},
    {"system_name": "伦理片",   "exact": ["伦理片"],     "keywords": ["伦理"],       "exclude": ["福利", "三级", "主播", "写真", "套图", "热舞", "课堂"]},
    {"system_name": "纪录片",   "exact": ["纪录片", "记录片"], "keywords": ["纪录", "科普"], "exclude": []},
    {"system_name": "动画片",   "exact": ["动画片", "动画电影"], "keywords": ["动画"],  "exclude": []},
    {"system_name": "短片",     "exact": ["短片"],       "keywords": [],             "exclude": []},
    {"system_name": "4K电影",   "exact": ["4K电影", "4K"], "keywords": [],            "exclude": []},
    {"system_name": "邵氏电影", "exact": ["邵氏电影", "邵氏"], "keywords": [],          "exclude": []},
    {"system_name": "Netflix",  "exact": ["Netflix", "Netflix电影", "Netflix自制剧"], "keywords": [], "exclude": []},
    # ── 连续剧 ──
    {"system_name": "国产剧",   "exact": ["国产剧"],     "keywords": ["国产电视", "国产连续", "大陆剧", "内地剧"], "exclude": []},
    {"system_name": "香港剧",   "exact": ["香港剧", "港台剧", "港剧"], "keywords": ["港澳剧", "TVB", "粤语剧"], "exclude": []},
    {"system_name": "韩国剧",   "exact": ["韩国剧"],     "keywords": ["韩剧"],       "exclude": []},
    {"system_name": "欧美剧",   "exact": ["欧美剧"],     "keywords": ["美国剧"],     "exclude": []},
    {"system_name": "台湾剧",   "exact": ["台湾剧"],     "keywords": ["台剧"],       "exclude": []},
    {"system_name": "日本剧",   "exact": ["日本剧"],     "keywords": ["日剧"],       "exclude": []},
    {"system_name": "泰国剧",   "exact": ["泰国剧"],     "keywords": ["泰剧"],       "exclude": []},
    {"system_name": "海外剧",   "exact": ["海外剧"],     "keywords": ["其他剧"],     "exclude": []},
    # ── 综艺 ──
    {"system_name": "大陆综艺", "exact": ["大陆综艺"],   "keywords": ["内地综艺", "国产综艺", "中国综艺"], "exclude": []},
    {"system_name": "港台综艺", "exact": ["港台综艺"],   "keywords": ["香港综艺", "台湾综艺", "港综", "台综"], "exclude": []},
    {"system_name": "日韩综艺", "exact": ["日韩综艺"],   "keywords": ["韩国综艺", "日本综艺", "韩综", "日综"], "exclude": []},
    {"system_name": "欧美综艺", "exact": ["欧美综艺"],   "keywords": [],             "exclude": []},
    # ── 动漫 ──
    {"system_name": "国产动漫", "exact": ["国产动漫", "中国动漫"], "keywords": ["国产动画", "国漫"], "exclude": []},
    {"system_name": "日韩动漫", "exact": ["日韩动漫", "日本动漫"], "keywords": ["韩国动漫", "日漫", "韩漫"], "exclude": []},
    {"system_name": "欧美动漫", "exact": ["欧美动漫"],   "keywords": ["美漫"],       "exclude": []},
    {"system_name": "港台动漫", "exact": ["港台动漫"],   "keywords": ["港漫", "台湾动画"], "exclude": []},
    {"system_name": "海外动漫", "exact": ["海外动漫"],   "keywords": [],             "exclude": []},
    # ── 体育 ──
    {"system_name": "足球",     "exact": ["足球"],       "keywords": [],             "exclude": []},
    {"system_name": "篮球",     "exact": ["篮球"],       "keywords": ["NBA"],       "exclude": []},
    {"system_name": "综合体育", "exact": [],             "keywords": ["斯诺克", "台球", "网球", "赛事", "其他赛事"], "exclude": []},
    {"system_name": "体育",     "exact": ["体育"],       "keywords": ["足球", "篮球", "NBA", "斯诺克", "台球", "网球", "赛事"], "exclude": []},
    # ── 短剧 ──
    {"system_name": "古装短剧", "exact": ["古装短剧"],   "keywords": ["古装", "仙侠"], "exclude": []},
    {"system_name": "都市短剧", "exact": ["都市短剧"],   "keywords": ["都市", "现代"], "exclude": []},
    {"system_name": "穿越短剧", "exact": ["穿越短剧"],   "keywords": ["穿越", "年代"], "exclude": []},
    {"system_name": "恋爱短剧", "exact": ["恋爱短剧"],   "keywords": ["恋爱", "言情", "女频", "闪婚", "离婚", "总裁"], "exclude": []},
    {"system_name": "其他短剧", "exact": [],             "keywords": ["脑洞", "逆袭", "爽文", "民国"], "exclude": []},
    {"system_name": "短剧",     "exact": ["短剧"],       "keywords": ["短剧", "爽剧", "微短剧"], "exclude": []},
    # ── 其他 ──
    {"system_name": "其他资源", "exact": ["预告片", "影视解说", "电视直播", "央视", "卫视", "演唱会", "未分类", "花絮", "资讯", "片场"], "keywords": [], "exclude": []},
]

SYSTEM_CATEGORY_NAMES = [r["system_name"] for r in MATCH_RULES]

ADULT_BLACKLIST = [
    "福利", "三级伦理", "网红主播", "明星", "福利图片",
    "写真套图", "直播", "成人", "色情", "AV",
    "三级", "两性", "写真",  # 扩展：港台三级、两性课堂、写真热舞
]

# 父分类上下文兜底：当子分类名本身无法匹配时，若父分类名命中关键词，
# 则将子分类归入对应系统分类（confidence=0.5，标记为 suggested）。
PARENT_CONTEXT_FALLBACK: dict[str, str] = {
    "短剧": "短剧",
    "爽文": "短剧",
    "体育": "体育",
    "资讯": "其他资源",
    "新闻": "其他资源",
}

# 短剧特征词：针对无父分类信息的站点，根据子分类名特征推断为短剧。
# 这些词在短剧命名中出现频率高，在常规电视剧/电影中极少单独作为分类名。
SHORT_DRAMA_INDICATORS = [
    "穿越", "仙侠", "脑洞", "总裁", "言情", "闪婚", "离婚",
    "逆袭", "爽文", "民国", "漫剧", "女频",
]


def _is_adult(name: str) -> bool:
    """检查分类名称是否命中成人内容黑名单。"""
    for kw in ADULT_BLACKLIST:
        if kw in name:
            return True
    # 特殊规则："伦理" + (福利|三级|主播|写真|套图)
    if "伦理" in name:
        for kw in ["福利", "三级", "主播", "写真", "套图"]:
            if kw in name:
                return True
    return False


def _build_dynamic_rule(name: str) -> dict:
    """为不在硬编码规则中的系统分类动态生成匹配规则。"""
    keywords: list[str] = []

    # 去掉常见后缀提取核心词
    for suffix in ["片", "剧", "综艺", "动漫"]:
        if name.endswith(suffix) and len(name) > len(suffix):
            core = name[:-len(suffix)]
            if len(core) >= 2:
                keywords.append(core)
            break

    # "xx动漫"也匹配"xx动画"
    if name.endswith("动漫"):
        keywords.append(name[:-2] + "动画")

    return {
        "system_name": name,
        "exact": [name],
        "keywords": keywords,
        "exclude": [],
    }


def _match_one(
    remote_name: str,
    extra_rules: list[dict] | None = None,
) -> tuple[str | None, float]:
    """对单个远程分类名执行匹配，返回 (system_name, confidence)。

    Args:
        remote_name: 资源站分类名称
        extra_rules: 动态生成的规则列表（优先级低于硬编码规则）
    """
    best_name: str | None = None
    best_conf: float = 0.0
    best_is_exact = False

    all_rules = MATCH_RULES + (extra_rules or [])

    for rule in all_rules:
        # 排除关键词检查
        excluded = False
        for ex in rule["exclude"]:
            if ex in remote_name:
                excluded = True
                break
        if excluded:
            continue

        # 精确匹配
        if remote_name in rule["exact"]:
            if best_conf < 1.0 or (best_conf == 1.0 and not best_is_exact):
                best_name = rule["system_name"]
                best_conf = 1.0
                best_is_exact = True
            continue

        # 关键词匹配
        for kw in rule["keywords"]:
            if kw in remote_name:
                if best_conf < 0.6 or (best_conf == 0.6 and best_is_exact):
                    best_name = rule["system_name"]
                    best_conf = 0.6
                    best_is_exact = False
                break

    return best_name, best_conf


def match_site_categories(
    site_id: int,
    remote_categories: list[dict],
    existing_mappings: list[dict],
    system_category_names: list[str] | None = None,
) -> SmartMatchResponse:
    """对站点所有远程分类执行智能匹配。

    Args:
        site_id: 站点 ID
        remote_categories: 资源站返回的 class 列表（含父分类和子分类）
        existing_mappings: 当前已保存的映射列表 [{remote_id, name}, ...]
        system_category_names: 当前数据库中的系统分类名列表（子分类），
                               用于为不在硬编码规则中的分类生成动态规则

    Returns:
        SmartMatchResponse: 匹配结果
    """
    # 构建已映射 lookup: remote_id -> system_name
    existing_map: dict[str, str] = {}
    for m in existing_mappings:
        rid = str(m.get("remote_id", ""))
        if rid:
            existing_map[rid] = m.get("name", "")

    # 为不在硬编码规则中的系统分类生成动态规则
    hardcoded_names = {r["system_name"] for r in MATCH_RULES}
    extra_rules: list[dict] = []
    if system_category_names:
        for sc_name in system_category_names:
            if sc_name not in hardcoded_names:
                extra_rules.append(_build_dynamic_rule(sc_name))

    # 构建父分类映射: type_id -> type_name（仅 type_pid=0 的父分类）
    parents: dict[str, str] = {}
    for raw in remote_categories:
        pid = raw.get("type_pid")
        if pid == 0 or pid == "0":
            rid = str(raw.get("type_id") or raw.get("id") or "")
            rname = str(raw.get("type_name") or raw.get("name") or "")
            if rid:
                parents[rid] = rname

    matches: list[SmartMatchItem] = []
    summary = {
        "total": 0,
        "auto_mapped": 0,
        "suggested": 0,
        "unrecognized": 0,
        "already_mapped": 0,
    }

    for raw in remote_categories:
        type_pid = raw.get("type_pid")
        if type_pid == 0 or type_pid == "0":
            continue  # 父分类不参与映射

        rid = str(raw.get("type_id") or raw.get("id") or "")
        name = str(raw.get("type_name") or raw.get("name") or "")
        if not rid:
            continue

        summary["total"] += 1

        # 1. 已映射检查
        if rid in existing_map:
            matches.append(SmartMatchItem(
                remote_id=rid,
                remote_name=name,
                suggested_system_name=existing_map[rid],
                confidence=1.0,
                status="already_mapped",
            ))
            summary["already_mapped"] += 1
            continue

        # 2. 成人内容过滤
        if _is_adult(name):
            matches.append(SmartMatchItem(
                remote_id=rid,
                remote_name=name,
                suggested_system_name=None,
                confidence=0.0,
                status="unrecognized",
                flag="adult_content",
            ))
            summary["unrecognized"] += 1
            continue

        # 3. 规则匹配（硬编码 + 动态规则）
        suggested, conf = _match_one(name, extra_rules)

        # 4. 兜底：父分类上下文 + 短剧特征词推断
        if conf < SMART_MATCH_SUGGEST_THRESHOLD:
            pid_str = str(type_pid) if type_pid is not None else ""
            parent_name = parents.get(pid_str, "")

            # 4a. 父分类上下文
            for kw, sys_name in PARENT_CONTEXT_FALLBACK.items():
                if kw in parent_name:
                    suggested = sys_name
                    conf = 0.5
                    break
            else:
                # 4b. 短剧特征词（仅当无父分类上下文时）
                for indicator in SHORT_DRAMA_INDICATORS:
                    if indicator in name:
                        suggested = "短剧"
                        conf = 0.5
                        break

        if conf >= SMART_MATCH_AUTO_THRESHOLD:
            status = "auto_mapped"
            summary["auto_mapped"] += 1
        elif conf >= SMART_MATCH_SUGGEST_THRESHOLD:
            status = "suggested"
            summary["suggested"] += 1
        else:
            status = "unrecognized"
            summary["unrecognized"] += 1

        matches.append(SmartMatchItem(
            remote_id=rid,
            remote_name=name,
            suggested_system_name=suggested,
            confidence=conf,
            status=status,
        ))

    return SmartMatchResponse(
        site_id=site_id,
        matches=matches,
        summary=SmartMatchSummary(**summary),
    )
