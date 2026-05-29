Feature: AC-002 分类映射（互斥约束）
  作为管理员
  我希望将各站点的子分类映射到统一的系统分类
  并且一个 remote_id 只能属于一个系统分类

  Scenario: 成功更新分类映射
    Given 已存在一个采集站
    When 调用 PUT /api/sites/{site_id}/categories
      | remote_id | name |
      | 1         | 电影 |
      | 2         | 电视剧 |
    Then 返回 200 且分类列表正确保存

  Scenario: 互斥约束阻止重复 remote_id
    Given 已存在一个采集站
    When 调用 PUT /api/sites/{site_id}/categories 提交重复的 remote_id
      | remote_id | name |
      | 1         | 电影 |
      | 1         | 电视剧 |
    Then 返回 400 且错误信息包含互斥冲突提示

  Scenario: 获取远程分类列表
    Given 已存在一个可访问的采集站
    When 调用 POST /api/sites/{site_id}/fetch-categories
    Then 返回分类列表，每个分类包含 remote_id 和 name
