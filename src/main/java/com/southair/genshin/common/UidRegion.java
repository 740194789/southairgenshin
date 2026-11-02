package com.southair.genshin.common;

/**
 * 由游戏内 UID 首位推断区服。
 *
 * <p>原神：1–5 国服，6 美服，7 欧服，8 亚服，9 港澳台服；
 * 星穹铁道：1–2 国服，6 美服，7 欧服，8 亚服，9 港澳台服。</p>
 */
public final class UidRegion {

    private UidRegion() {
    }

    /** 返回区服名称；UID 为空或无法识别时返回「未知区服」。 */
    public static String regionOf(String uid, String game) {
        String text = uid == null ? "" : uid.trim();
        if (text.isEmpty()) {
            return "未知区服";
        }
        char first = text.charAt(0);
        if (GameType.isStarRail(GameType.normalize(game))) {
            switch (first) {
                case '1':
                case '2':
                    return "国服";
                case '6':
                    return "美服";
                case '7':
                    return "欧服";
                case '8':
                    return "亚服";
                case '9':
                    return "港澳台服";
                default:
                    return "未知区服";
            }
        }
        switch (first) {
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
                return "国服";
            case '6':
                return "美服";
            case '7':
                return "欧服";
            case '8':
                return "亚服";
            case '9':
                return "港澳台服";
            default:
                return "未知区服";
        }
    }
}
