package com.southair.genshin.module.wish;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 原神「捕获明光」计数：按角色活动池 50/50 的 歪 / 没歪 序列推算。
 *
 * <p>规则：歪了计数 +1（上限 3），没歪计数 -1（下限 0）；计数到 3 后下一次
 * 50/50 必定为当期 UP（捕获明光），触发后计数重置为 1。歪后紧跟的大保底 UP
 * 不属于 50/50，跳过且不改变计数。</p>
 */
public final class CapturingRadiance {

    public static final int MAX_COUNTER = 3;

    private CapturingRadiance() {
    }

    /** 一次序列的计算结果：每条五星是否触发捕获明光，以及序列结束后的计数状态。 */
    public static final class Result {

        private final List<Boolean> triggered;
        private final int counter;

        Result(List<Boolean> triggered, int counter) {
            this.triggered = triggered;
            this.counter = counter;
        }

        /** 第 index 条五星是否由捕获明光触发（与入参顺序一致）。 */
        public boolean isTriggered(int index) {
            return triggered.get(index);
        }

        public int getCounter() {
            return counter;
        }

        /** 下一次 50/50 的 UP 概率：0/1/2/满 → 50% / 55% / 75% / 100%。 */
        public int getNextUpRate() {
            if (counter >= MAX_COUNTER) {
                return 100;
            }
            if (counter == 2) {
                return 75;
            }
            if (counter == 1) {
                return 55;
            }
            return 50;
        }
    }

    /**
     * @param fives 已筛选为角色活动池五星、并按出货时间升序排列的记录
     */
    public static Result compute(List<WishRecord> fives) {
        return compute(fives, false);
    }

    /**
     * @param fives      已筛选为角色活动池五星、并按出货时间升序排列的记录
     * @param honorMarks 为 true 时，已标记 captureTriggered 的记录视为本条的 50/50
     *                   触发了捕获明光（用户手动修正优先），用于统计页展示
     */
    public static Result compute(List<WishRecord> fives, boolean honorMarks) {
        List<Boolean> triggered = new ArrayList<>(fives.size());
        int counter = 0;
        boolean pendingGuarantee = false;
        for (WishRecord record : fives) {
            boolean up = Boolean.TRUE.equals(record.getIsUp());
            if (honorMarks && Boolean.TRUE.equals(record.getCaptureTriggered())) {
                // 已标记触发：计数视为重置为 1，并从下一条继续累计
                triggered.add(true);
                counter = 1;
                pendingGuarantee = false;
                continue;
            }
            boolean capture = false;
            if (pendingGuarantee) {
                // 大保底：必定 UP，不参与 50/50 计数（数据异常按歪兜底）
                if (!up) {
                    counter = Math.min(MAX_COUNTER, counter + 1);
                }
                pendingGuarantee = !up;
            } else if (up) {
                if (counter >= MAX_COUNTER) {
                    capture = true;
                    counter = 1;
                } else {
                    counter = Math.max(0, counter - 1);
                }
            } else {
                counter = Math.min(MAX_COUNTER, counter + 1);
                pendingGuarantee = true;
            }
            triggered.add(capture);
        }
        return new Result(Collections.unmodifiableList(triggered), counter);
    }
}
