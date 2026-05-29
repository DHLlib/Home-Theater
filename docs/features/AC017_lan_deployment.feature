Feature: AC-017 局域网部署与静态托管
  作为部署者
  我希望项目能在局域网内通过单一端口访问
  并且前端构建产物由后端静态托管

  Scenario: 后端绑定所有接口
    When 启动后端服务
    Then uvicorn 绑定 0.0.0.0，监听所有网络接口

  Scenario: CORS 支持局域网访问
    When 前端通过局域网 IP 访问后端 API
    Then CORS 中间件允许请求通过

  Scenario: 静态文件托管
    Given 前端已完成 npm run build
    When 用户访问根路径 /
    Then FastAPI 返回 frontend/dist/index.html
    And JS/CSS/图片等静态资源按正确 MIME 类型返回

  Scenario: 缓存头策略
    When 请求不同类型的静态资源
    Then HTML 响应携带 no-cache
    And JS/CSS 响应携带 public, max-age=60, must-revalidate
    And 其他静态资源响应携带 public, max-age=86400
