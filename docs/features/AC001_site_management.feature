Feature: AC-001 站点管理
  作为管理员
  我希望新增/编辑/删除采集站，配置 base_url 和分类映射
  以便系统能从多个资源站聚合视频数据

  Scenario: 创建采集站
    Given 用户提交采集站信息
      | name     | base_url                  | enabled | sort |
      | 测试站点 | https://example.com/api   | true    | 1    |
    When 调用 POST /api/sites
    Then 返回 200 和新创建的站点，包含 id
    And 站点列表中包含该站点

  Scenario: 更新采集站排序
    Given 已存在一个采集站
    When 调用 PATCH /api/sites/{site_id} 修改 sort 为 99
    Then 返回 200 且 sort 字段更新为 99

  Scenario: 删除采集站
    Given 已存在一个采集站
    When 调用 DELETE /api/sites/{site_id}
    Then 返回 200 且站点列表中不再包含该站点

  Scenario: 探测采集站连通性
    Given 已存在一个采集站
    When 调用 POST /api/sites/{site_id}/probe
    Then 返回 ProbeResult，ok 为 true 或 false
