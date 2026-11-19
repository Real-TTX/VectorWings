using System.Reflection;
using MatGame.Shell;
using VectorWings.Local;

namespace VectorWings.App;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args) => ShellApp.Run(args, new ShellOptions
    {
        GameId = "vectorwings",
        Title = "VectorWings",
        DefaultServer = typeof(Program).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => attribute.Key == "MatGameDefaultServer")?.Value,
        Repository = "Real-TTX/VectorWings",
        LocalGame = () => new VectorWingsLocal(),
        Background = Color.FromArgb(15, 23, 38)
    });
}
