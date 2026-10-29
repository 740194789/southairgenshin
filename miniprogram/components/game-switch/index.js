Component({
  properties: {
    game: {
      type: String,
      value: 'genshin'
    }
  },

  methods: {
    onTap: function (event) {
      var game = event.currentTarget.dataset.game;
      if (game === this.data.game) {
        return;
      }
      this.triggerEvent('change', { game: game });
    }
  }
});
