Feature: AC-004 视频搜索
  作为用户
  我希望通过关键字搜索视频
  并按聚合规则展示结果

  Background:
    Given 后台已缓存视频数据

  Scenario: 正常搜索
    When 用户调用 GET /api/videos/search?wd=哪吒
    Then 返回 AggregatedListResponse
    And items 中标题包含「哪吒」的视频已聚合展示

  Scenario: 空关键词
    When 用户调用 GET /api/videos/search?wd=
    Then 返回 400，错误信息提示搜索词不能为空

  Scenario: 无结果
    When 用户调用 GET /api/videos/search?wd=不存在的词
    Then 返回空列表
