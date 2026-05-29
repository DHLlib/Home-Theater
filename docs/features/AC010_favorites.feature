Feature: AC-010 收藏管理
  作为用户
  我希望收藏感兴趣的视频
  并按 title + year 去重

  Scenario: 添加收藏
    Given 用户浏览视频详情
    When 用户点击收藏按钮
    Then 系统调用 POST /api/favorites
    And 返回收藏记录，包含 title 和 year

  Scenario: 重复收藏同一视频
    Given 用户已收藏 (title="Inception", year=2010)
    When 用户再次提交相同 title 和 year 的收藏
    Then 系统返回 409，提示已存在

  Scenario: 查看收藏列表
    When 用户访问收藏页
    Then 系统调用 GET /api/favorites
    And 返回按创建时间倒序排列的收藏列表

  Scenario: 删除收藏
    Given 用户已有一条收藏
    When 用户点击删除
    Then 系统调用 DELETE /api/favorites/{fav_id}
    And 收藏列表中不再包含该记录
