Feature: AC-002 分类映射（手动挂载）
  作为管理员
  我希望把每个站点的远程分类手动挂到系统小类
  并且一个站点内的一个远程分类只能挂一个小类

  Background:
    Given 已有系统分类「电影」及其小类「动作片」「喜剧片」
    And 已有一个采集站，并刷新到远程分类「动作片」「喜剧片」

  Scenario: 挂载远程分类到小类
    When 向 POST /api/category-settings/links 提交
      | site_id | remote_id | system_category_id |
      | 1       | 6         | 动作片 id          |
    Then 返回 200，linked=1
    And 该站点下所有属于 remote_id=6 的来源对应视频重算为「动作片」

  Scenario: 同一远程分类移动到另一个小类
    Given remote_id=6 已挂到「动作片」
    When 再次挂载 remote_id=6 到「喜剧片」
    Then 只保留一条挂载关系，目标为「喜剧片」
    And 受影响视频重新投票

  Scenario: 同名远程分类在不同站点挂不同小类
    Given 站点 A 与站点 B 都有远程分类「动作片」
    When 站点 A 挂到「动作片」，站点 B 挂到「喜剧片」
    Then 两个站点的来源分别按各自挂载关系投票

  Scenario: 一个远程分类只能挂一个小类
    When 尝试把 remote_id=6 挂到大类「电影」
    Then 返回 400，提示只能挂到小类

  Scenario: 解除挂载
    Given remote_id=6 已挂到「动作片」
    When DELETE /api/category-settings/links
    Then 挂载关系删除，相关视频重算；无票数的视频变为未分类

  Scenario: 删除系统分类不迁移
    Given 「动作片」挂着远程分类并有 610 个视频
    When 删除「动作片」
    Then 挂载关系删除
    And 这 610 个视频直接变为未分类，不重新投票
    And 确认弹窗显示「610 个视频变为未分类」

  Scenario: 挂载请求由后端队列异步执行
    When 向 POST /api/category-settings/links 提交一批挂载
    Then 立即返回 202 与 job_id，不在 HTTP 请求里重算视频
    And 后台工作协程按顺序执行，用户可继续提交下一个小类
    And 前端轮询 GET /api/category-settings/jobs/{job_id} 直到 done/failed

  Scenario: 上一项未完成时继续挂载下一个分类
    Given 第一个挂载任务仍在 queued/running
    When 用户切换到另一个小类并提交挂载
    Then 新请求同样立即入队，旧任务不会被阻塞或取消

  Scenario: 新增小类即使 0 内容也可见
    When 在「电影」下新增小类「测试分类」
    Then 系统树立即出现该小类
    And 首页分类栏/分区锚点仍能看到 0 内容的启用分类
