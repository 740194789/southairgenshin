package com.southair.genshin.security;

/**
 * 当前登录用户上下文（ThreadLocal）。
 */
public final class UserContext {

    private static final ThreadLocal<Long> HOLDER = new ThreadLocal<>();

    private UserContext() {
    }

    public static void set(Long userId) {
        HOLDER.set(userId);
    }

    public static Long get() {
        return HOLDER.get();
    }

    /**
     * 获取当前用户 ID，未登录时抛出 401。
     */
    public static Long require() {
        Long userId = HOLDER.get();
        if (userId == null) {
            throw new com.southair.genshin.common.BusinessException(401, "请先登录");
        }
        return userId;
    }

    public static void clear() {
        HOLDER.remove();
    }
}
