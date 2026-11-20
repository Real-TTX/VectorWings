using MatGame.Sdk;
using MatGame.Sdk.Controls;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using VectorWings.Core;

namespace VectorWings.Module.Pages.Admin;

/// <summary>A pilot's file in the administration: call sign, portrait, starting ship, granted missions, reset.</summary>
[Authorize(Policy = GameAccounts.AdminPolicy)]
public sealed class PlayerModel(ProgressStore store, IGameAccounts accounts) : PageModel
{
    [BindProperty(SupportsGet = true)] public long Id { get; set; }
    [BindProperty] public string? Callsign { get; set; }
    [BindProperty] public string? Avatar { get; set; }
    [BindProperty] public int Ship { get; set; }
    [BindProperty] public bool[] Grant { get; set; } = new bool[Levels.Missions.Count];
    public string AccountName { get; private set; } = "";
    public Progress? Progress { get; private set; }

    public static readonly string[] AvatarNames = ["Mira (Otter)", "Brakk (Dachs)", "Sola (Luchs)", "Pip (Eule)", "Rico (Waschbär)", "Penny (Pinguin)", "Bo (Bär)", "Nima (Roter Panda)"];
    public IReadOnlyList<Choice> Avatars { get; } = PilotProfile.Avatars.Select((a, i) => new Choice(a, AvatarNames[i])).ToList();
    public IReadOnlyList<Choice> Ships { get; } = [new("0", "VW-3 Lanze"), new("1", "VW-5 Sperber"), new("2", "VW-9 Bastion")];

    public async Task<IActionResult> OnGetAsync(CancellationToken ct)
    {
        var actor = User.ToAccount();
        if (actor?.IsAdmin != true) return Forbid();
        if (!await LoadAsync(ct)) return NotFound();
        var pilot = Progress!.Pilot;
        Callsign = pilot?.Callsign ?? AccountName;
        Avatar = pilot?.Avatar ?? PilotProfile.Avatars[0];
        Ship = pilot?.Ship ?? 0;
        Grant = Enumerable.Range(0, Levels.Missions.Count).Select(m => Progress.Granted.Contains(m)).ToArray();
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(CancellationToken ct)
    {
        var actor = User.ToAccount();
        if (actor?.IsAdmin != true) return Forbid();
        if (!await LoadAsync(ct)) return NotFound();
        await AdminLogic.SavePilotAsync(actor, store, Id, PilotProfile.Clean(Callsign, Avatar, Ship, AccountName),
            Enumerable.Range(0, Levels.Missions.Count).Where(m => m < Grant.Length && Grant[m]).ToArray(), ct);
        return RedirectToPage("/Admin/VectorWings/Index", new { View = "players" });
    }

    public async Task<IActionResult> OnPostResetAsync(CancellationToken ct)
    {
        var actor = User.ToAccount();
        if (actor?.IsAdmin != true) return Forbid();
        await AdminLogic.ResetPilotAsync(actor, store, Id, ct);
        return RedirectToPage(new { Id });
    }

    private async Task<bool> LoadAsync(CancellationToken ct)
    {
        var names = await accounts.FindManyAsync([Id], ct);
        if (!names.TryGetValue(Id, out var account)) return false;
        AccountName = account.Name;
        Progress = await store.ProfileAsync(Id, ct);
        return true;
    }
}
