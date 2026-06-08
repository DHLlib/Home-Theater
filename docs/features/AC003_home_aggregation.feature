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

  Scenario: 预聚合缓存加速（无分类筛选）
    Given 后台已完成预聚合缓存刷新
    When 用户访问首页 GET /api/videos（无 category 参数）
    Then 从 AggregatedVideoV1/V2 活跃表直接读取
    And 响应时间 < 100ms

  Scenario: 同名视频 year 回填聚合
    Given VideoCache 中存在以下记录：
      | title | year | site_id |
      | 测试电影 | null | 1       |
      | 测试电影 | 2024 | 2       |
      | 测试电影 | 2024 | 3       |
    When 后台执行预聚合缓存刷新
    Then 生成一条聚合记录：title="测试电影", year=2024
    And 该记录包含 3 个 sources

  Scenario: 按分类筛选时走实时聚合
    When 用户访问首页并传入 category=动作片
    Then 从 VideoCache 实时聚合返回
    And 仅返回属于动作片分类的视频
