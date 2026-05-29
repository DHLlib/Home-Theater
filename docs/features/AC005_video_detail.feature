Feature: AC-005 视频详情
  作为用户
  我希望查看视频的详细信息和选集列表
  并且优先使用缓存减少等待时间

  Background:
    Given 某视频已在 VideoCache 中存在缓存

  Scenario: 命中缓存返回详情
    When 用户调用 POST /api/videos/detail
    Then 返回 DetailResponse，包含封面、简介、演员、导演、选集列表
    And 若缓存中有 play_url_raw，则解析为 episodes 列表

  Scenario: 缓存过期后实时回源
    Given 视频缓存已过期超过 7 天
    When 用户请求详情
    Then 系统实时请求源站获取最新数据
    And 更新 VideoCache 缓存时间

  Scenario: 后缀归一化
    Given 详情中包含 feifan 或 360zy 后缀的播放地址
    When 系统返回 episodes 列表
    Then feifan 后缀已解析为真实 m3u8 并替换为 ffm3u8
    And 360zy 后缀已替换为 ffm3u8
