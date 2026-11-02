package com.southair.genshin.module.stats;

import com.southair.genshin.module.resource.dto.ResourceVO;
import com.southair.genshin.module.wish.WishRecord;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 首页概览：资源与抽数换算、保底进度、抽卡统计、卡池分布、最近出货。
 */
public class OverviewVO implements Serializable {

    private static final long serialVersionUID = 1L;

    private ResourceVO resource;

    /** 出货记录数 */
    private long wishCount;
    /** 五星出货数 */
    private long fiveStarWishes;
    /** 四星出货数 */
    private long fourStarWishes;
    /** 五星出货率（%） */
    private double fiveStarRate;
    /** 五星平均出货抽数 */
    private double avgFiveStarPity;

    /** 最近一条记录所属卡池 */
    private String pityPool;
    /** 该卡池保底上限：角色活动 / 常驻 90，武器活动 80 */
    private int pityCap;
    /** 最近一条记录的保底计数（原始值） */
    private int latestPityCount;
    /** 当前保底计数：最近一条为五星时重置为 0 */
    private int currentPityCount;
    /** 距离保底还差的抽数 */
    private int pullsToPity;
    /** 距离保底还差的货币（原石 / 星琼） */
    private long primogemsToPity;
    /** 当前资源折算抽数是否足够到达保底 */
    private boolean pityEnough;
    /** 资源结余抽数（负数表示还差） */
    private long pityBalance;
    /** 最近一条记录是否为五星 */
    private boolean latestFiveStar;

    /** 捕获明光：角色活动池连续未中 UP 的五星次数 */
    private int captureLossCount;
    /** 下次五星为当期 UP 的预估概率（%） */
    private int captureNextUpRate;
    /** 还需再连歪几次必定触发捕获明光 */
    private int captureRemaining;
    /** 下次五星是否必定触发捕获明光 */
    private boolean captureGuaranteed;
    /** 角色活动池五星总数 */
    private long characterFiveStarWishes;
    /** 角色活动池 UP 五星数 */
    private long characterUpWishes;
    /** 角色活动池 UP 率（%） */
    private double characterUpRate;

    /** 角色 UP 平均周期抽数（含歪掉的五星，按 UP 计） */
    private double characterUpAvgPity;
    /** 角色 UP 周期样本数 */
    private long characterUpSamples;
    /** 武器 / 光锥 UP 平均周期抽数（含歪掉的五星，按 UP 计） */
    private double weaponUpAvgPity;
    /** 武器 / 光锥 UP 周期样本数 */
    private long weaponUpSamples;

    /** 一共抽过多少抽（Σ 五星记录的保底抽数） */
    private long totalPulls;
    /** 角色活动池小保底次数（不含大保底） */
    private long softPityCount;
    /** 小保底未歪次数 */
    private long softPityUpCount;
    /** 小保底不歪率（%） */
    private double softPityUpRate;
    /** 角色活动池歪掉的次数 */
    private long lostCount;
    /** 最多连续歪几次（按小保底计算） */
    private int maxLossStreak;
    /** 最多连续不歪几次（按小保底计算） */
    private int maxUpStreak;
    /** 捕获明光触发次数（用户标记） */
    private long captureTriggeredCount;
    /** 平均每个 UP 角色消耗的货币（原石 / 星琼） */
    private long avgPrimogemsPerUpCharacter;
    /** 平均每个限定武器 / 光锥消耗的货币（原石 / 星琼） */
    private long avgPrimogemsPerUpWeapon;

    private List<NameCount> poolDistribution;
    private List<WishRecord> recentWishes;
    /** 全部五星记录（按抽卡时间升序），用于五星抽数柱形图 */
    private List<WishRecord> fiveStarRecords;
    /** 按卡池拆分的保底与出货统计 */
    private List<PoolStat> poolStats;
    /** 四星角色出货分布（按名称聚合） */
    private List<FourStarStat> fourStarCharacters = new ArrayList<>();
    /** 四星角色中标记为 UP 的次数（手动标记，仅作参考） */
    private long fourStarUpWishes;

    public ResourceVO getResource() {
        return resource;
    }

    public void setResource(ResourceVO resource) {
        this.resource = resource;
    }

    public long getWishCount() {
        return wishCount;
    }

    public void setWishCount(long wishCount) {
        this.wishCount = wishCount;
    }

    public long getFiveStarWishes() {
        return fiveStarWishes;
    }

    public void setFiveStarWishes(long fiveStarWishes) {
        this.fiveStarWishes = fiveStarWishes;
    }

    public long getFourStarWishes() {
        return fourStarWishes;
    }

    public void setFourStarWishes(long fourStarWishes) {
        this.fourStarWishes = fourStarWishes;
    }

    public double getFiveStarRate() {
        return fiveStarRate;
    }

    public void setFiveStarRate(double fiveStarRate) {
        this.fiveStarRate = fiveStarRate;
    }

    public double getAvgFiveStarPity() {
        return avgFiveStarPity;
    }

    public void setAvgFiveStarPity(double avgFiveStarPity) {
        this.avgFiveStarPity = avgFiveStarPity;
    }

    public String getPityPool() {
        return pityPool;
    }

    public void setPityPool(String pityPool) {
        this.pityPool = pityPool;
    }

    public int getPityCap() {
        return pityCap;
    }

    public void setPityCap(int pityCap) {
        this.pityCap = pityCap;
    }

    public int getLatestPityCount() {
        return latestPityCount;
    }

    public void setLatestPityCount(int latestPityCount) {
        this.latestPityCount = latestPityCount;
    }

    public int getCurrentPityCount() {
        return currentPityCount;
    }

    public void setCurrentPityCount(int currentPityCount) {
        this.currentPityCount = currentPityCount;
    }

    public int getPullsToPity() {
        return pullsToPity;
    }

    public void setPullsToPity(int pullsToPity) {
        this.pullsToPity = pullsToPity;
    }

    public long getPrimogemsToPity() {
        return primogemsToPity;
    }

    public void setPrimogemsToPity(long primogemsToPity) {
        this.primogemsToPity = primogemsToPity;
    }

    public boolean isPityEnough() {
        return pityEnough;
    }

    public void setPityEnough(boolean pityEnough) {
        this.pityEnough = pityEnough;
    }

    public long getPityBalance() {
        return pityBalance;
    }

    public void setPityBalance(long pityBalance) {
        this.pityBalance = pityBalance;
    }

    public boolean isLatestFiveStar() {
        return latestFiveStar;
    }

    public void setLatestFiveStar(boolean latestFiveStar) {
        this.latestFiveStar = latestFiveStar;
    }

    public int getCaptureLossCount() {
        return captureLossCount;
    }

    public void setCaptureLossCount(int captureLossCount) {
        this.captureLossCount = captureLossCount;
    }

    public int getCaptureNextUpRate() {
        return captureNextUpRate;
    }

    public void setCaptureNextUpRate(int captureNextUpRate) {
        this.captureNextUpRate = captureNextUpRate;
    }

    public int getCaptureRemaining() {
        return captureRemaining;
    }

    public void setCaptureRemaining(int captureRemaining) {
        this.captureRemaining = captureRemaining;
    }

    public boolean isCaptureGuaranteed() {
        return captureGuaranteed;
    }

    public void setCaptureGuaranteed(boolean captureGuaranteed) {
        this.captureGuaranteed = captureGuaranteed;
    }

    public long getCharacterFiveStarWishes() {
        return characterFiveStarWishes;
    }

    public void setCharacterFiveStarWishes(long characterFiveStarWishes) {
        this.characterFiveStarWishes = characterFiveStarWishes;
    }

    public long getCharacterUpWishes() {
        return characterUpWishes;
    }

    public void setCharacterUpWishes(long characterUpWishes) {
        this.characterUpWishes = characterUpWishes;
    }

    public double getCharacterUpRate() {
        return characterUpRate;
    }

    public void setCharacterUpRate(double characterUpRate) {
        this.characterUpRate = characterUpRate;
    }

    public double getCharacterUpAvgPity() {
        return characterUpAvgPity;
    }

    public void setCharacterUpAvgPity(double characterUpAvgPity) {
        this.characterUpAvgPity = characterUpAvgPity;
    }

    public long getCharacterUpSamples() {
        return characterUpSamples;
    }

    public void setCharacterUpSamples(long characterUpSamples) {
        this.characterUpSamples = characterUpSamples;
    }

    public double getWeaponUpAvgPity() {
        return weaponUpAvgPity;
    }

    public void setWeaponUpAvgPity(double weaponUpAvgPity) {
        this.weaponUpAvgPity = weaponUpAvgPity;
    }

    public long getWeaponUpSamples() {
        return weaponUpSamples;
    }

    public void setWeaponUpSamples(long weaponUpSamples) {
        this.weaponUpSamples = weaponUpSamples;
    }

    public long getTotalPulls() {
        return totalPulls;
    }

    public void setTotalPulls(long totalPulls) {
        this.totalPulls = totalPulls;
    }

    public long getSoftPityCount() {
        return softPityCount;
    }

    public void setSoftPityCount(long softPityCount) {
        this.softPityCount = softPityCount;
    }

    public long getSoftPityUpCount() {
        return softPityUpCount;
    }

    public void setSoftPityUpCount(long softPityUpCount) {
        this.softPityUpCount = softPityUpCount;
    }

    public double getSoftPityUpRate() {
        return softPityUpRate;
    }

    public void setSoftPityUpRate(double softPityUpRate) {
        this.softPityUpRate = softPityUpRate;
    }

    public long getLostCount() {
        return lostCount;
    }

    public void setLostCount(long lostCount) {
        this.lostCount = lostCount;
    }

    public int getMaxLossStreak() {
        return maxLossStreak;
    }

    public void setMaxLossStreak(int maxLossStreak) {
        this.maxLossStreak = maxLossStreak;
    }

    public int getMaxUpStreak() {
        return maxUpStreak;
    }

    public void setMaxUpStreak(int maxUpStreak) {
        this.maxUpStreak = maxUpStreak;
    }

    public long getCaptureTriggeredCount() {
        return captureTriggeredCount;
    }

    public void setCaptureTriggeredCount(long captureTriggeredCount) {
        this.captureTriggeredCount = captureTriggeredCount;
    }

    public long getAvgPrimogemsPerUpCharacter() {
        return avgPrimogemsPerUpCharacter;
    }

    public void setAvgPrimogemsPerUpCharacter(long avgPrimogemsPerUpCharacter) {
        this.avgPrimogemsPerUpCharacter = avgPrimogemsPerUpCharacter;
    }

    public long getAvgPrimogemsPerUpWeapon() {
        return avgPrimogemsPerUpWeapon;
    }

    public void setAvgPrimogemsPerUpWeapon(long avgPrimogemsPerUpWeapon) {
        this.avgPrimogemsPerUpWeapon = avgPrimogemsPerUpWeapon;
    }

    public List<NameCount> getPoolDistribution() {
        return poolDistribution;
    }

    public void setPoolDistribution(List<NameCount> poolDistribution) {
        this.poolDistribution = poolDistribution;
    }

    public List<WishRecord> getRecentWishes() {
        return recentWishes;
    }

    public void setRecentWishes(List<WishRecord> recentWishes) {
        this.recentWishes = recentWishes;
    }

    public List<WishRecord> getFiveStarRecords() {
        return fiveStarRecords;
    }

    public void setFiveStarRecords(List<WishRecord> fiveStarRecords) {
        this.fiveStarRecords = fiveStarRecords;
    }

    public List<PoolStat> getPoolStats() {
        return poolStats;
    }

    public void setPoolStats(List<PoolStat> poolStats) {
        this.poolStats = poolStats;
    }

    public List<FourStarStat> getFourStarCharacters() {
        return fourStarCharacters;
    }

    public void setFourStarCharacters(List<FourStarStat> fourStarCharacters) {
        this.fourStarCharacters = fourStarCharacters;
    }

    public long getFourStarUpWishes() {
        return fourStarUpWishes;
    }

    public void setFourStarUpWishes(long fourStarUpWishes) {
        this.fourStarUpWishes = fourStarUpWishes;
    }

    /**
     * 单个卡池的保底 / 出货统计。
     */
    public static class PoolStat implements Serializable {

        private static final long serialVersionUID = 1L;

        private String pool;
        /** 该池五星保底上限 */
        private int cap;
        /** 当前保底计数（最近一条为五星时重置为 0） */
        private int currentPity;
        /** 距五星保底还差的抽数 */
        private int pullsToPity;
        /** 该池记录总数 */
        private long wishCount;
        /** 该池五星数 */
        private long fiveStarCount;
        /** 该池五星平均出货抽数 */
        private double avgFiveStarPity;
        /** 最近一个五星未中 UP / 定轨，下次五星必定命中 */
        private boolean upGuaranteed;
        /** 武器定轨命定值（0–2，仅武器活动池有值） */
        private int fatePoints;

        public String getPool() {
            return pool;
        }

        public void setPool(String pool) {
            this.pool = pool;
        }

        public int getCap() {
            return cap;
        }

        public void setCap(int cap) {
            this.cap = cap;
        }

        public int getCurrentPity() {
            return currentPity;
        }

        public void setCurrentPity(int currentPity) {
            this.currentPity = currentPity;
        }

        public int getPullsToPity() {
            return pullsToPity;
        }

        public void setPullsToPity(int pullsToPity) {
            this.pullsToPity = pullsToPity;
        }

        public long getWishCount() {
            return wishCount;
        }

        public void setWishCount(long wishCount) {
            this.wishCount = wishCount;
        }

        public long getFiveStarCount() {
            return fiveStarCount;
        }

        public void setFiveStarCount(long fiveStarCount) {
            this.fiveStarCount = fiveStarCount;
        }

        public double getAvgFiveStarPity() {
            return avgFiveStarPity;
        }

        public void setAvgFiveStarPity(double avgFiveStarPity) {
            this.avgFiveStarPity = avgFiveStarPity;
        }

        public boolean isUpGuaranteed() {
            return upGuaranteed;
        }

        public void setUpGuaranteed(boolean upGuaranteed) {
            this.upGuaranteed = upGuaranteed;
        }

        public int getFatePoints() {
            return fatePoints;
        }

        public void setFatePoints(int fatePoints) {
            this.fatePoints = fatePoints;
        }
    }

    /**
     * 四星角色出货统计项。
     */
    public static class FourStarStat implements Serializable {

        private static final long serialVersionUID = 1L;

        private String name;
        private long count;
        private long upCount;

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public long getCount() {
            return count;
        }

        public void setCount(long count) {
            this.count = count;
        }

        public long getUpCount() {
            return upCount;
        }

        public void setUpCount(long upCount) {
            this.upCount = upCount;
        }
    }

    /**
     * 名称 - 数量 统计项。
     */
    public static class NameCount implements Serializable {

        private static final long serialVersionUID = 1L;

        private String name;
        private long value;

        public NameCount() {
        }

        public NameCount(String name, long value) {
            this.name = name;
            this.value = value;
        }

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public long getValue() {
            return value;
        }

        public void setValue(long value) {
            this.value = value;
        }
    }
}
