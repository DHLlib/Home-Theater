Feature: AC-014 VideoCache 缓存管理
  作为系统
  我希望缓存视频详情数据
  并在超过 5000 行时自动淘汰最旧记录

  Background:
    Given 系统已启用 VideoCache

  Scenario: 详情请求触发缓存写入
    When 视频详情被请求且缓存未命中或已过期
    Then 系统实时回源并将结果 upsert 到 VideoCache

  Scenario: 缓存上限自动淘汰
    Given VideoCache 已存在 5000 条记录
    When 新的详情被写入缓存
    Then 系统按 cached_at ASC 删除最旧的 1 条记录
    And 最终表内剩余 5000 条

  Scenario: 手动清理缓存
    When 管理员调用 DELETE /api/videos/cache
    Then 返回删除的记录数
    And VideoCache 表被清空
