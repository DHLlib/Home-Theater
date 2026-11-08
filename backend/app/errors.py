"""统一错误处理系统。

定义标准错误响应格式，提供全局异常处理器。
"""
from __future__ import annotations

import logging
from enum import Enum
from typing import Any, TypeVar

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar("T")


class ErrorCode(str, Enum):
    """业务错误码。"""
    # 通用错误 1xxx
    UNKNOWN_ERROR = "1000"
    VALIDATION_ERROR = "1001"
    NOT_FOUND = "1004"
    CONFLICT = "1009"
    INTERNAL_ERROR = "1500"
    EXTERNAL_ERROR = "1502"

    # 站点相关 2xxx
    SITE_NOT_FOUND = "2001"
    SITE_DISABLED = "2002"
    SITE_UNREACHABLE = "2003"
    SITE_PARSE_ERROR = "2004"
    SITE_NO_CATEGORIES = "2005"

    # 视频相关 3xxx
    VIDEO_NOT_FOUND = "3001"
    VIDEO_NO_SOURCES = "3002"
    VIDEO_PARSE_ERROR = "3003"

    # 下载相关 4xxx
    DOWNLOAD_NOT_FOUND = "4001"
    DOWNLOAD_ROOT_NOT_SET = "4002"
    DOWNLOAD_TASK_CONFLICT = "4003"

    # 分类相关 5xxx
    CATEGORY_NOT_FOUND = "5001"
    CATEGORY_EXISTS = "5002"
    CATEGORY_CYCLE = "5003"
    CATEGORY_NO_TEMPLATE = "5004"

    # 收藏相关 6xxx
    FAVORITE_NOT_FOUND = "6001"

    # 刮削器相关 7xxx
    CRAWLER_NOT_RUNNING = "7001"
    CRAWLER_BUSY = "7002"


class ErrorResponse(BaseModel):
    """标准错误响应格式。"""
    code: str
    message: str
    details: dict[str, Any] | None = None


class ApiError(HTTPException):
    """业务异常基类，自动转换为标准错误响应。"""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(status_code=status_code, detail=message)
        self.code = code.value
        self.message = message
        self.details = details


# ============ 便捷函数 ============

def site_not_found(site_id: int) -> ApiError:
    return ApiError(ErrorCode.SITE_NOT_FOUND, f"站点不存在: {site_id}", 404)


def site_disabled(site_name: str) -> ApiError:
    return ApiError(ErrorCode.SITE_DISABLED, f"站点已禁用: {site_name}", 400)


def site_unreachable(site_name: str, reason: str | None = None) -> ApiError:
    return ApiError(
        ErrorCode.SITE_UNREACHABLE,
        f"站点不可达: {site_name}",
        502,
        {"reason": reason} if reason else None,
    )


def video_not_found(title: str) -> ApiError:
    return ApiError(ErrorCode.VIDEO_NOT_FOUND, f"视频不存在: {title}", 404)


def download_not_found(task_id: int) -> ApiError:
    return ApiError(ErrorCode.DOWNLOAD_NOT_FOUND, f"下载任务不存在: {task_id}", 404)


def download_root_not_set() -> ApiError:
    return ApiError(ErrorCode.DOWNLOAD_ROOT_NOT_SET, "下载根目录未配置", 409)


def category_not_found(name: str) -> ApiError:
    return ApiError(ErrorCode.CATEGORY_NOT_FOUND, f"分类不存在: {name}", 404)


def category_exists(name: str) -> ApiError:
    return ApiError(ErrorCode.CATEGORY_EXISTS, f"分类已存在: {name}", 409)


def category_cycle() -> ApiError:
    return ApiError(ErrorCode.CATEGORY_CYCLE, "不能形成循环父子关系", 400)


def favorite_not_found(fav_id: int) -> ApiError:
    return ApiError(ErrorCode.FAVORITE_NOT_FOUND, f"收藏不存在: {fav_id}", 404)


def crawler_not_running() -> ApiError:
    return ApiError(ErrorCode.CRAWLER_NOT_RUNNING, "刮削器未启动", 503)


def validation_error(message: str) -> ApiError:
    return ApiError(ErrorCode.VALIDATION_ERROR, message, 400)


def internal_error(message: str = "内部服务器错误") -> ApiError:
    return ApiError(ErrorCode.INTERNAL_ERROR, message, 500)


def external_error(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError(ErrorCode.EXTERNAL_ERROR, message, 502, details)


# ============ 全局异常处理器 ============

async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    """处理 ApiError，返回标准格式。"""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            code=exc.code,
            message=exc.message,
            details=exc.details,
        ).model_dump(),
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """处理 FastAPI HTTPException，转换为标准格式。"""
    # 根据状态码推断错误码
    code_map = {
        400: ErrorCode.VALIDATION_ERROR,
        404: ErrorCode.NOT_FOUND,
        409: ErrorCode.CONFLICT,
        500: ErrorCode.INTERNAL_ERROR,
        502: ErrorCode.EXTERNAL_ERROR,
        503: ErrorCode.EXTERNAL_ERROR,
    }
    code = code_map.get(exc.status_code, ErrorCode.UNKNOWN_ERROR)
    
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            code=code.value,
            message=str(exc.detail),
            details=None,
        ).model_dump(),
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """处理未捕获的异常，返回 500。"""
    logger.exception(
        "unhandled_exception path=%s method=%s",
        request.url.path,
        request.method,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            code=ErrorCode.INTERNAL_ERROR.value,
            message="内部服务器错误",
            details={"type": type(exc).__name__},
        ).model_dump(),
    )
