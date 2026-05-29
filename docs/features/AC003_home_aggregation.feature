Feature: AC-003 首页视频聚合列表
  作为用户
  我希望在首页看到来自多个资源站的视频聚合列表
  并且同名同年的视频合并为一张卡片

  Background:
    Given 后台已刮削并缓存多个站点的视频数据

  Scenario: 默认展示聚合列表
    When 用户访问首页 GET /api/videos
    Then 返回 AggregatedListResponse
    And items 中同名同年的视频已合并为一条记录
    And 每个记录包含 sources 数组，标明来源站点

  Scenario: 按分类筛选
    When 用户访问首页并传入 category=电影
    Then 仅返回属于电影分类的聚合视频

  Scenario: source 模式展示
    When 用户访问首页并传入 mode=source
    Then 返回平铺列表，不聚合去重
