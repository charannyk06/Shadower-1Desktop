
from PIL import Image
import sys

def remove_white_background(input_path, output_path):
    print(f"Processing {input_path}...")
    try:
        img = Image.open(input_path)
        img = img.convert("RGBA")
        datas = img.getdata()
        
        newData = []
        for item in datas:
            # Change all white (also shades of whites)
            # using a threshold to capture compression artifacts
            if item[0] > 240 and item[1] > 240 and item[2] > 240:
                newData.append((255, 255, 255, 0))
            else:
                newData.append(item)
        
        img.putdata(newData)
        
        # Crop the image to remove excess transparent space
        bbox = img.getbbox()
        if bbox:
            img = img.crop(bbox)
            
        img.save(output_path, "PNG")
        print(f"Saved transparent logo to {output_path}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # Use the uploaded image path
    input_file = "/Users/charannsrinivas/.gemini/antigravity/brain/facfb508-f97e-40df-a490-ccb235bb7cd8/uploaded_image_1767979211651.jpg"
    output_file = "/Users/charannsrinivas/Documents/Shadower-1/public/logo-transparent.png"
    remove_white_background(input_file, output_file)
