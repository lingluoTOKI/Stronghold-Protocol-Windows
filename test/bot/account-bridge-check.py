"""机器人侧联调：用线上真实插件 game_account.py 验证绑定码流程。
在 astrbot 容器内运行，指向隔离的账号服务夹具。
"""
import asyncio, json, sys, importlib.util

PLUGIN = "/AstrBot/data/plugins/astrbot_plugin_wushu_ops/game_account.py"
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3999"
KEY = sys.argv[2] if len(sys.argv) > 2 else ""
REALM = sys.argv[3] if len(sys.argv) > 3 else "3000"
CODE = sys.argv[4] if len(sys.argv) > 4 else ""

spec = importlib.util.spec_from_file_location("game_account", PLUGIN)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FakeEvent:
    def __init__(self, platform_name="qq_official", platform_id="大肥鱼-官方", group_id="G1", sender_id="qq-user-1"):
        self._p = platform_name
        self._i = platform_id
        self._g = group_id
        self._s = sender_id

    def get_platform_name(self): return self._p
    def get_platform_id(self): return self._i
    def get_group_id(self): return self._g
    def get_sender_id(self): return self._s


def config(url=BASE):
    return {
        "game_account_platform_id": "大肥鱼-官方",
        "game_account_url_3000": url,
        "game_account_url_3001": url,
        "game_account_bridge_key": KEY,
    }


async def main():
    results = []

    # 1) 正常路径：群里 @机器人 发 绑定游戏 3000 <码>
    r = await mod.verify_game_account(FakeEvent(), config(), REALM, CODE)
    results.append(("正常绑定", r))

    # 2) 平台不匹配（不是 qq_official）
    r = await mod.verify_game_account(FakeEvent(platform_name="aiocqhttp"), config(), REALM, CODE)
    results.append(("平台不符", r))

    # 3) 平台 ID 不匹配
    r = await mod.verify_game_account(FakeEvent(platform_id="其他机器人"), config(), REALM, CODE)
    results.append(("机器人ID不符", r))

    # 4) 私聊（无群号）
    r = await mod.verify_game_account(FakeEvent(group_id=None), config(), REALM, CODE)
    results.append(("非群聊", r))

    # 5) 绑定码格式非法
    r = await mod.verify_game_account(FakeEvent(), config(), REALM, "NOT-A-CODE")
    results.append(("码格式非法", r))

    # 6) realm 非法
    r = await mod.verify_game_account(FakeEvent(), config(), "9999", CODE)
    results.append(("realm非法", r))

    # 7) 桥接密钥未配置
    c = config(); c["game_account_bridge_key"] = "short"
    r = await mod.verify_game_account(FakeEvent(), c, REALM, CODE)
    results.append(("密钥未配置", r))

    # 8) 错误绑定码（服务器会拒绝）
    r = await mod.verify_game_account(FakeEvent(), config(), REALM, "AABBCCDDEEFF0011")
    results.append(("错误码", r))

    for name, value in results:
        print(f"[{name}] {value}")

    # 断言
    ok = results[0][1].startswith("已验证")
    assert ok, "正常路径未通过: " + results[0][1]
    assert "尚未启用" in results[1][1]
    assert "尚未启用" in results[2][1]
    assert "请在游戏交流群" in results[3][1]
    assert "请复制游戏里生成的完整指令" in results[4][1]
    assert "请复制游戏里生成的完整指令" in results[5][1]
    assert "尚未配置完成" in results[6][1]
    assert "验证未完成" in results[7][1]
    print("ALL_BOT_ASSERTIONS_PASSED")


asyncio.run(main())
