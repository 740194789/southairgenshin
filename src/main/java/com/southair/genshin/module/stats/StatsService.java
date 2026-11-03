package com.southair.genshin.module.stats;

import com.southair.genshin.common.GameType;
import com.southair.genshin.module.resource.ResourceService;
import com.southair.genshin.module.wish.WishRecord;
import com.southair.genshin.module.wish.WishRecordRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

@Service
public class StatsService {

    private final WishRecordRepository wishRepository;
    private final ResourceService resourceService;

    public StatsService(WishRecordRepository wishRepository, ResourceService resourceService) {
        this.wishRepository = wishRepository;
        this.resourceService = resourceService;
    }

    /**
     * 首页概览：账号资源与抽数换算 + 抽卡统计（按游戏隔离）。
     */
    @Transactional
    public OverviewVO overview(Long userId, String game) {
        String gameKey = GameType.normalize(game);
        OverviewVO vo = new OverviewVO();
        vo.setResource(resourceService.get(userId, gameKey));

        long wishCount = wishRepository.countByUserIdAndGame(userId, gameKey);
        long fiveStarWishes = wishRepository.countByUserIdAndGameAndRarity(userId, gameKey, 5);
        long fourStarWishes = wishRepository.countByUserIdAndGameAndRarity(userId, gameKey, 4);

        // 记录只保留四星角色与五星物品，总抽数按五星记录消耗的抽数累加
        Long fiveStarPulls = wishRepository.sumFiveStarPity(userId, gameKey);
        long totalPulls = fiveStarPulls == null ? 0L : fiveStarPulls;
        vo.setWishCount(wishCount);
        vo.setFiveStarWishes(fiveStarWishes);
        vo.setFourStarWishes(fourStarWishes);
        vo.setFiveStarRate(totalPulls == 0 ? 0D : round(fiveStarWishes * 100D / totalPulls));

        Double avgPity = wishRepository.avgFiveStarPity(userId, gameKey);
        vo.setAvgFiveStarPity(avgPity == null ? 0D : round(avgPity));

        List<OverviewVO.NameCount> distribution = new ArrayList<>();
        for (Object[] row : wishRepository.countGroupByPool(userId, gameKey)) {
            String name = row[0] == null ? "未分类" : String.valueOf(row[0]);
            long value = ((Number) row[1]).longValue();
            distribution.add(new OverviewVO.NameCount(name, value));
        }
        vo.setPoolDistribution(distribution);

        List<WishRecord> recent = wishRepository.findTop5ByUserIdAndGameOrderByWishTimeDesc(userId, gameKey);
        vo.setRecentWishes(recent);
        applyPityProgress(vo, recent.isEmpty() ? null : recent.get(0));
        List<WishRecord> all = wishRepository.findByUserIdAndGameOrderByWishTimeAsc(userId, gameKey);
        applyPoolStats(vo, all, gameKey);
        applyLuckStats(vo, all);
        if (!GameType.isStarRail(gameKey)) {
            applyCapturingRadiance(vo, userId, gameKey);
        }
        return vo;
    }

    /**
     * 按卡池统计：保底进度、五星数、五星平均抽数与 UP / 定轨保底状态。
     */
    private void applyPoolStats(OverviewVO vo, List<WishRecord> all, String game) {
        String[][] pools = GameType.isStarRail(game)
                ? new String[][]{{"角色活动", "90"}, {"光锥活动", "80"}, {"联动", "90"}, {"常驻", "90"}}
                : new String[][]{{"角色活动", "90"}, {"武器活动", "80"}, {"集录祈愿", "90"}, {"常驻", "90"}};

        List<OverviewVO.PoolStat> stats = new ArrayList<>();
        for (String[] def : pools) {
            String pool = def[0];
            int cap = Integer.parseInt(def[1]);
            long wishCount = 0;
            long fiveStarCount = 0;
            double pitySum = 0D;
            WishRecord latest = null;
            WishRecord latestFive = null;

            for (WishRecord record : all) {
                if (!pool.equals(record.getPool())) {
                    continue;
                }
                wishCount++;
                latest = record;
                if (Integer.valueOf(5).equals(record.getRarity())) {
                    fiveStarCount++;
                    pitySum += record.getPityCount() == null ? 0 : record.getPityCount();
                    latestFive = record;
                }
            }

            int currentPity = 0;
            if (latest != null) {
                currentPity = Integer.valueOf(5).equals(latest.getRarity())
                        ? 0 : (latest.getPityCount() == null ? 0 : latest.getPityCount());
            }

            OverviewVO.PoolStat stat = new OverviewVO.PoolStat();
            stat.setPool(pool);
            stat.setCap(cap);
            stat.setCurrentPity(currentPity);
            stat.setPullsToPity(Math.max(cap - currentPity, 0));
            stat.setWishCount(wishCount);
            stat.setFiveStarCount(fiveStarCount);
            stat.setAvgFiveStarPity(fiveStarCount == 0 ? 0D : round(pitySum / fiveStarCount));
            stat.setUpGuaranteed(!"常驻".equals(pool) && latestFive != null
                    && !Boolean.TRUE.equals(latestFive.getIsUp()));
            stat.setFatePoints(resolveFatePoints(all, pool));
            stats.add(stat);
        }
        vo.setPoolStats(stats);
        applyUpCyclePity(vo, all, GameType.isStarRail(game) ? "光锥活动" : "武器活动");
    }

    /**
     * 武器定轨命定值：按该池五星顺序，命中 UP 归零，未命中小幅累计；原神定轨满 1 后下一把必定定轨。
     * 星穹铁道光锥池没有定轨机制，恒为 0。
     */
    private int resolveFatePoints(List<WishRecord> all, String pool) {
        if (!"武器活动".equals(pool)) {
            return 0;
        }
        int points = 0;
        for (WishRecord record : all) {
            if (!pool.equals(record.getPool()) || !Integer.valueOf(5).equals(record.getRarity())) {
                continue;
            }
            points = Boolean.TRUE.equals(record.getIsUp()) ? 0 : Math.min(1, points + 1);
        }
        return points;
    }

    /**
     * 抽卡统计：总抽数、歪的次数、小保底不歪率、连歪 / 连不歪纪录、
     * 捕获明光触发次数，以及 UP 角色 / 武器的平均抽数与货币成本。
     *
     * <p>连歪 / 连不歪只统计「小保底」：歪后紧跟的大保底 UP 不计入，也不打断连歪纪录。</p>
     */
    private void applyLuckStats(OverviewVO vo, List<WishRecord> all) {
        long totalPulls = 0L;
        long softCount = 0L;
        long softUp = 0L;
        long lost = 0L;
        long captures = 0L;
        int currentLoss = 0;
        int currentUp = 0;
        int maxLoss = 0;
        int maxUp = 0;
        boolean guaranteed = false;
        List<WishRecord> fiveStars = new ArrayList<>();

        for (WishRecord record : all) {
            if (!Integer.valueOf(5).equals(record.getRarity())) {
                continue;
            }
            fiveStars.add(record);
            totalPulls += record.getPityCount() == null ? 0 : record.getPityCount();
            if (Boolean.TRUE.equals(record.getCaptureTriggered())) {
                captures++;
            }
            if (!"角色活动".equals(record.getPool())) {
                continue;
            }
            boolean up = Boolean.TRUE.equals(record.getIsUp());
            if (guaranteed) {
                // 大保底：必定 UP，不计入小保底统计，也不影响连歪 / 连不歪
                guaranteed = !up;
                continue;
            }
            softCount++;
            if (up) {
                softUp++;
                currentUp++;
                currentLoss = 0;
                maxUp = Math.max(maxUp, currentUp);
            } else {
                lost++;
                currentLoss++;
                currentUp = 0;
                maxLoss = Math.max(maxLoss, currentLoss);
            }
            guaranteed = !up;
        }

        vo.setTotalPulls(totalPulls);
        vo.setSoftPityCount(softCount);
        vo.setSoftPityUpCount(softUp);
        vo.setSoftPityUpRate(softCount == 0 ? 0D : round(softUp * 100D / softCount));
        vo.setLostCount(lost);
        vo.setMaxLossStreak(maxLoss);
        vo.setMaxUpStreak(maxUp);
        vo.setCaptureTriggeredCount(captures);
        vo.setFiveStarRecords(fiveStars);
        vo.setAvgPrimogemsPerUpCharacter(vo.getCharacterUpAvgPity() <= 0 ? 0L
                : Math.round(vo.getCharacterUpAvgPity() * ResourceService.PRIMOGEMS_PER_PULL));
        vo.setAvgPrimogemsPerUpWeapon(vo.getWeaponUpAvgPity() <= 0 ? 0L
                : Math.round(vo.getWeaponUpAvgPity() * ResourceService.PRIMOGEMS_PER_PULL));
    }

    /**
     * 统计「每个 UP 的实际平均抽数」：按卡池内五星顺序累加保底抽数，
     * 命中 UP 时把这一轮（可能包含歪掉的五星）的总抽数计入样本。
     * 用于按用户往期数据估算抽卡期望。
     */
    private void applyUpCyclePity(OverviewVO vo, List<WishRecord> all, String weaponPool) {
        double charSum = 0D;
        long charUps = 0;
        int charCycle = 0;
        double weaponSum = 0D;
        long weaponUps = 0;
        int weaponCycle = 0;

        for (WishRecord record : all) {
            if (!Integer.valueOf(5).equals(record.getRarity())) {
                continue;
            }
            int pity = record.getPityCount() == null ? 0 : record.getPityCount();
            if ("角色活动".equals(record.getPool())) {
                charCycle += pity;
                if (Boolean.TRUE.equals(record.getIsUp())) {
                    charSum += charCycle;
                    charUps++;
                    charCycle = 0;
                }
            } else if (weaponPool.equals(record.getPool())) {
                weaponCycle += pity;
                if (Boolean.TRUE.equals(record.getIsUp())) {
                    weaponSum += weaponCycle;
                    weaponUps++;
                    weaponCycle = 0;
                }
            }
        }

        vo.setCharacterUpAvgPity(charUps == 0 ? 0D : round(charSum / charUps));
        vo.setCharacterUpSamples(charUps);
        vo.setWeaponUpAvgPity(weaponUps == 0 ? 0D : round(weaponSum / weaponUps));
        vo.setWeaponUpSamples(weaponUps);
    }

    /**
     * 原神「捕获明光」：角色活动池连续未中 UP 的五星会累积进度，
     * 连续 3 次歪后下一次五星必定为当期 UP。
     *
     * <p>歪后紧跟的 UP 属于大保底，不打断连歪计数；只有自然 UP 才清零。</p>
     *
     * <p>官方公布：小保底基础 50%，含捕获明光综合 55%；连歪 1/2 次的
     * 55% / 75% 为社区通行估算值。</p>
     */
    private void applyCapturingRadiance(OverviewVO vo, Long userId, String game) {
        List<WishRecord> fives = wishRepository
                .findByUserIdAndGameAndPoolAndRarityOrderByWishTimeAscIdAsc(
                        userId, game, "角色活动", 5);

        int losses = 0;
        long upCount = 0;
        boolean lastWasLoss = false;
        for (WishRecord record : fives) {
            boolean up = Boolean.TRUE.equals(record.getIsUp());
            if (up) {
                upCount++;
                if (lastWasLoss) {
                    // 歪后紧跟 UP：普通大保底保留连歪计数；连歪已达 3 次时
                    // 这次即捕获明光触发，计数清零
                    if (losses >= 3) {
                        losses = 0;
                    }
                } else {
                    // 自然 UP（50/50 直接命中），连歪清零
                    losses = 0;
                }
                lastWasLoss = false;
            } else {
                losses++;
                lastWasLoss = true;
            }
        }

        int rate;
        if (losses >= 3) {
            rate = 100;
        } else if (losses == 2) {
            rate = 75;
        } else if (losses == 1) {
            rate = 55;
        } else {
            rate = 50;
        }

        vo.setCaptureLossCount(losses);
        vo.setCaptureNextUpRate(rate);
        vo.setCaptureRemaining(Math.max(0, 3 - losses));
        vo.setCaptureGuaranteed(losses >= 3);
        vo.setCharacterFiveStarWishes(fives.size());
        vo.setCharacterUpWishes(upCount);
        vo.setCharacterUpRate(fives.isEmpty() ? 0D : round(upCount * 100D / fives.size()));
    }

    /**
     * 保底进度：角色活动 / 常驻上限 90 抽，武器活动（原神）/ 光锥活动（星穹铁道）上限 80 抽。
     * 最近一条记录为五星时，保底计数已重置为 0。
     */
    private void applyPityProgress(OverviewVO vo, WishRecord latest) {
        String pool = latest == null ? null : latest.getPool();
        int cap = ("武器活动".equals(pool) || "光锥活动".equals(pool)) ? 80 : 90;
        int latestCount = latest == null || latest.getPityCount() == null ? 0 : latest.getPityCount();
        boolean latestFiveStar = latest != null && Integer.valueOf(5).equals(latest.getRarity());
        int currentCount = latestFiveStar ? 0 : latestCount;
        int pullsToPity = Math.max(cap - currentCount, 0);

        vo.setPityPool(pool);
        vo.setPityCap(cap);
        vo.setLatestPityCount(latestCount);
        vo.setLatestFiveStar(latestFiveStar);
        vo.setCurrentPityCount(currentCount);
        vo.setPullsToPity(pullsToPity);
        vo.setPrimogemsToPity((long) pullsToPity * ResourceService.PRIMOGEMS_PER_PULL);

        long balance = vo.getResource().getTotalPulls() - pullsToPity;
        vo.setPityBalance(balance);
        vo.setPityEnough(balance >= 0);
    }

    private double round(double value) {
        return BigDecimal.valueOf(value).setScale(1, RoundingMode.HALF_UP).doubleValue();
    }
}
