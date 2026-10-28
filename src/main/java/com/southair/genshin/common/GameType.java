package com.southair.genshin.common;

/**
 * 支持的游戏类型。
 */
public final class GameType {

    /** 原神 */
    public static final String GENSHIN = "genshin";
    /** 崩坏：星穹铁道 */
    public static final String STAR_RAIL = "starrail";

    private GameType() {
    }

    /**
     * 归一化游戏标识，无法识别时回退到原神。
     */
    public static String normalize(String game) {
        if (game == null) {
            return GENSHIN;
        }
        String value = game.trim().toLowerCase();
        if (value.equals("starrail") || value.equals("star_rail") || value.equals("star-rail")
                || value.equals("sr") || value.equals("hsr")) {
            return STAR_RAIL;
        }
        return GENSHIN;
    }

    public static boolean isStarRail(String game) {
        return STAR_RAIL.equals(normalize(game));
    }
}
