Feature: AC-011 下载任务管理
  作为用户
  我希望创建下载任务、暂停/恢复/删除
  并一次性配置下载根目录

  Background:
    Given 用户已配置 download_root

  Scenario: 创建下载任务
    Given 用户在详情页选择了某一集并点击下载
    When 系统调用 POST /api/downloads
    Then 返回 DownloadTask，status 为 queued
    And file_path 以 download_root 为前缀

  Scenario: 暂停下载任务
    Given 存在一个状态为 downloading 的任务
    When 用户调用 POST /api/downloads/{task_id}/pause
    Then 任务状态变为 paused

  Scenario: 恢复下载任务
    Given 存在一个状态为 paused 的任务
    When 用户调用 POST /api/downloads/{task_id}/resume
    Then 任务状态变为 queued，等待 worker 重新调度

  Scenario: 删除下载任务并清理文件
    Given 存在一个已完成或失败的任务
    When 用户调用 DELETE /api/downloads/{task_id}?delete_file=true
    Then 任务从数据库删除，且本地文件被一并删除

  Scenario: 未配置下载根目录时禁止创建
    Given 系统未配置 download_root
    When 用户尝试创建下载任务
    Then 返回 409，提示 download_root not configured
