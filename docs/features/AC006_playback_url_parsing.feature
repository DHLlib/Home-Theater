Feature: AC-006 播放地址解析
  作为用户
  我希望系统能正确解析视频播放地址
  以便获取可播放的真实视频链接

  Background:
    Given 资源站返回的原始播放字符串格式为 "集数$地址$后缀"

  Scenario: 正常解析多行播放地址
    Given 原始播放字符串为：
      """
      第1集$https://example.com/1.mp4$mp4
      第2集$https://example.com/2.mp4$mp4
      """
    When 调用 parse_episodes 解析
    Then 返回 2 个 Episode 对象
    And 第 1 个 Episode 的 ep_name 为 "第1集", url 为 "https://example.com/1.mp4", suffix 为 "mp4"
    And 第 2 个 Episode 的 ep_name 为 "第2集", url 为 "https://example.com/2.mp4", suffix 为 "mp4"

  Scenario: 格式不足 3 段时抛 ValueError
    Given 原始播放字符串为 "第1集$https://example.com/1.mp4"
    When 调用 parse_episodes 解析
    Then 抛出 ValueError，提示格式不合规

  Scenario: 空输入返回空列表
    Given 原始播放字符串为空
    When 调用 parse_episodes 解析
    Then 返回空列表

  Scenario: 跳过空行并正确索引
    Given 原始播放字符串为：
      """
      第1集$https://example.com/1.mp4$mp4

      第2集$https://example.com/2.mp4$mp4
      """
    When 调用 parse_episodes 解析
    Then 返回 2 个 Episode 对象
    And 索引从 0 开始顺序赋值，分别为 0 和 1

  Scenario: 后缀含美元符号时正确解析
    Given 原始播放字符串为 "第1集$https://example.com/1$ext$mp4"
    When 调用 parse_episodes 解析
    Then 第 1 个 Episode 的 suffix 为 "ext$mp4"

  Scenario: feifan 分享页解析为真实 m3u8 并替换后缀为 ffm3u8
    Given 存在一个 feifan 分享页，包含 HTML：
      """
      <script>
        const url = "/2026xxx/index.m3u8?sign=abc";
      </script>
      """
    And 分享页地址为 "https://vip.ffzy-plays.com/share/xxx"
    When 调用 resolve_feifan 解析
    Then 返回 "https://vip.ffzy-plays.com/2026xxx/index.m3u8?sign=abc"
    And 在 GET /api/play/episodes 接口中，feifan 后缀被统一替换为 "ffm3u8"

  Scenario: feifan 分享页提取的 url 已是完整 http 链接
    Given 存在一个 feifan 分享页，包含 HTML：
      """
      <script>
        const url = "https://other.com/playlist.m3u8";
      </script>
      """
    When 调用 resolve_feifan 解析
    Then 返回 "https://other.com/playlist.m3u8"

  Scenario: feifan 分享页无 const url 时返回 None
    Given 存在一个 feifan 分享页，包含 HTML "无视频链接"
    When 调用 resolve_feifan 解析
    Then 返回 None

  Scenario: 360zy 后缀在 episodes 接口中统一替换为 ffm3u8
    Given 原始播放字符串为 "第1集$https://example.com/playlist.m3u8$360zy"
    When 通过 GET /api/play/episodes 获取集数列表
    Then 返回的 Episode 的 suffix 为 "ffm3u8"

  Scenario: dytt 分享页解析为真实 m3u8 并替换后缀为 ffm3u8
    Given 存在一个 dytt 分享页
    When 调用 resolve_feifan 解析（dytt 与 feifan 共享解析器）
    Then 返回真实 m3u8 地址
    And 在 GET /api/play/episodes 接口中，dytt 后缀被统一替换为 "ffm3u8"

  Scenario: 155m3u8 后缀自动归一化为 ffm3u8
    Given 原始播放字符串为 "第1集$https://example.com/playlist.m3u8$155m3u8"
    When 通过 GET /api/play/episodes 获取集数列表
    Then 返回的 Episode 的 suffix 为 "ffm3u8"

  Scenario: xlyun 后缀自动归一化为 ffm3u8
    Given 原始播放字符串为 "第1集$https://example.com/playlist.m3u8$xlyun"
    When 通过 GET /api/play/episodes 获取集数列表
    Then 返回的 Episode 的 suffix 为 "ffm3u8"

  Scenario: 网络异常时 resolve_feifan 返回 None
    Given feifan 分享页网络不可达
    When 调用 resolve_feifan 解析
    Then 返回 None
