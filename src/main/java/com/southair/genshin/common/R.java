package com.southair.genshin.common;

import java.io.Serializable;

/**
 * 统一响应结构。
 *
 * <pre>
 * { "code": 0, "message": "ok", "data": {...}, "timestamp": 1730000000000 }
 * </pre>
 *
 * <p>code = 0 表示成功，非 0 表示业务或系统异常。</p>
 */
public class R<T> implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 0 = 成功 */
    private int code;
    private String message;
    private T data;
    private long timestamp;

    public R() {
        this.timestamp = System.currentTimeMillis();
    }

    public R(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
        this.timestamp = System.currentTimeMillis();
    }

    public static <T> R<T> ok(T data) {
        return new R<>(0, "ok", data);
    }

    public static <T> R<T> ok() {
        return new R<>(0, "ok", null);
    }

    public static <T> R<T> fail(int code, String message) {
        return new R<>(code, message, null);
    }

    public int getCode() {
        return code;
    }

    public void setCode(int code) {
        this.code = code;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public T getData() {
        return data;
    }

    public void setData(T data) {
        this.data = data;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }
}
